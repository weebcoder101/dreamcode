import { Effect, Layer, Context, Schedule, Logger } from "effect"
import { Database } from "@/storage/storage"
import { inArray, eq, and, lte, sql } from "drizzle-orm"
import { GlobalBus } from "@/bus/global"
import * as Bus from "@/bus/bus"
import type { SessionID, MessageID } from "@/session/schema"
import { ActorRegistryTable, ActorForkContextTable } from "./actor.sql"
import type { Actor, ActorStatus, ActorOutcome, ContextMode, Lifecycle, SpawnMode, ToolWhitelist } from "./schema"
import * as Events from "./events"

const log = Effect.log
const SYSTEM_SPAWNED_AGENT_TYPES = new Set(["checkpointer", "writer"])

const STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const SCAN_INTERVAL_MS = 60 * 1000 // every 60s

type ActorRow = typeof ActorRegistryTable.$inferSelect

function fromRow(row: ActorRow): Actor {
  return {
    sessionID: row.session_id,
    actorID: row.actor_id,
    mode: row.mode,
    parentActorID: row.parent_actor_id ?? undefined,
    status: row.status,
    lastOutcome: row.last_outcome ?? undefined,
    lifecycle: row.lifecycle,
    agent: row.agent,
    description: row.description,
    contextMode: row.context_mode,
    contextWatermark: row.context_watermark ?? undefined,
    background: Boolean(row.background),
    tools: row.tools ?? undefined,
    lastTurnTime: row.last_turn_time,
    turnCount: row.turn_count,
    gateReactCount: row.gate_react_count,
    lastError: row.last_error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  }
}

export interface Interface {
  readonly register: (input: {
    sessionID: SessionID
    actorID: string
    mode: SpawnMode
    parentActorID?: string
    agent: string
    description: string
    contextMode: ContextMode
    contextWatermark?: MessageID
    background: boolean
    lifecycle: Lifecycle
    tools?: ToolWhitelist
  }) => Effect.Effect<Actor>

  readonly updateStatus: (
    sessionID: SessionID,
    actorID: string,
    patch: {
      status: ActorStatus
      lastOutcome?: ActorOutcome | undefined
      lastError?: string | undefined
    },
  ) => Effect.Effect<void>
  readonly updateTurn: (sessionID: SessionID, actorID: string) => Effect.Effect<void>
  readonly get: (sessionID: SessionID, actorID: string) => Effect.Effect<Actor | undefined>
  readonly listBySession: (sessionID: SessionID) => Effect.Effect<Actor[]>
  readonly listActive: () => Effect.Effect<Actor[]>
  readonly listByParent: (sessionID: SessionID, parentActorID: string) => Effect.Effect<Actor[]>
  readonly renderForAgent: (sessionID: SessionID) => Effect.Effect<string>
  readonly agentTypeFor: (sessionID: SessionID, actorID: string) => Effect.Effect<string>
  readonly isSystemSpawned: (sessionID: SessionID, actorID: string) => Effect.Effect<boolean>
  readonly allocateActorID: (sessionID: SessionID, agentType: string) => Effect.Effect<string>
  readonly updateGateReactCount: (sessionID: SessionID, actorID: string, count: number) => Effect.Effect<void>
  readonly getGateReactCount: (sessionID: SessionID, actorID: string) => Effect.Effect<number>
  readonly persistForkContext: (sessionID: SessionID, actorID: string, context: unknown) => Effect.Effect<void>
  readonly loadForkContext: (sessionID: SessionID, actorID: string) => Effect.Effect<unknown | undefined>
  readonly deleteForkContext: (sessionID: SessionID, actorID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/ActorRegistry") {}

export const layer: Layer.Layer<Service, never, Bus.Service | Database.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const { db } = yield* Database.Service

    // --- CRUD methods ---

    const register = Effect.fn("ActorRegistry.register")(function* (input: {
      sessionID: SessionID
      actorID: string
      mode: SpawnMode
      parentActorID?: string
      agent: string
      description: string
      contextMode: ContextMode
      contextWatermark?: MessageID
      background: boolean
      lifecycle: Lifecycle
      tools?: ToolWhitelist
    }) {
      const now = Date.now()
      const row = {
        session_id: input.sessionID,
        actor_id: input.actorID,
        mode: input.mode,
        parent_actor_id: input.parentActorID ?? null,
        status: "pending" as const,
        last_outcome: null,
        lifecycle: input.lifecycle,
        agent: input.agent,
        description: input.description,
        context_mode: input.contextMode,
        context_watermark: input.contextWatermark ?? null,
        background: input.background,
        tools: input.tools ?? null,
        last_turn_time: now,
        turn_count: 0,
        gate_react_count: 0,
        last_error: null,
        time_completed: null,
        time_created: now,
        time_updated: now,
      }
      yield* Effect.orDie(db.insert(ActorRegistryTable).values(row).run())
      yield* bus.publish(Events.ActorRegistered, {
        sessionID: input.sessionID,
        actorID: input.actorID,
        mode: input.mode,
        parentActorID: input.parentActorID,
        description: input.description,
        agent: input.agent,
        background: input.background,
      })
      return fromRow(row)
    })

    const updateStatus = Effect.fn("ActorRegistry.updateStatus")(function* (
      sessionID: SessionID,
      actorID: string,
      patch: {
        status: ActorStatus
        lastOutcome?: ActorOutcome | undefined
        lastError?: string | undefined
      },
    ) {
      const now = Date.now()
      const isTerminal = patch.status === "idle" && patch.lastOutcome !== undefined
      const set: Record<string, unknown> = {
        status: patch.status,
        time_updated: now,
        ...(isTerminal ? { time_completed: now } : {}),
      }
      if (patch.lastOutcome !== undefined) set.last_outcome = patch.lastOutcome
      if (patch.lastError !== undefined) set.last_error = patch.lastError
      else if (patch.lastOutcome !== undefined && patch.lastOutcome !== "failure") set.last_error = null
      yield* Effect.orDie(db
        .update(ActorRegistryTable)
        .set(set)
        .where(
          and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
        )
        .run())
      // Re-read so the event payload reflects committed row values (not the
      // sparse patch). Skip publish if the row vanished between UPDATE and
      // SELECT — a dropped event beats a misleading one.
      const row = yield* Effect.orDie(db
        .select()
        .from(ActorRegistryTable)
        .where(
          and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
        )
        .get())
      if (!row) return
      yield* bus.publish(Events.ActorStatusChanged, {
        sessionID,
        actorID,
        status: row.status,
        ...(row.last_outcome ? { lastOutcome: row.last_outcome } : {}),
        turnCount: row.turn_count,
        lastTurnTime: row.last_turn_time,
        ...(row.last_error ? { error: row.last_error } : {}),
      })
    })

    const updateTurn = Effect.fn("ActorRegistry.updateTurn")(function* (sessionID: SessionID, actorID: string) {
      const now = Date.now()
      yield* Effect.orDie(db
        .update(ActorRegistryTable)
        .set({
          last_turn_time: now,
          turn_count: sql`${ActorRegistryTable.turn_count} + 1`,
          time_updated: now,
        })
        .where(
          and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
        )
        .run())
    })

    const get = Effect.fn("ActorRegistry.get")(function* (sessionID: SessionID, actorID: string) {
      const row = yield* Effect.orDie(db
        .select()
        .from(ActorRegistryTable)
        .where(
          and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
        )
        .get())
      return row ? fromRow(row) : undefined
    })

    const listBySession = Effect.fn("ActorRegistry.listBySession")(function* (sessionID: SessionID) {
      const rows = yield* Effect.orDie(db.select().from(ActorRegistryTable).where(eq(ActorRegistryTable.session_id, sessionID)).all())
      return rows.map(fromRow)
    })

    const listActive = Effect.fn("ActorRegistry.listActive")(function* () {
      const rows = yield* Effect.orDie(db
        .select()
        .from(ActorRegistryTable)
        .where(
          and(
            inArray(ActorRegistryTable.status, ["pending", "running"]),
            eq(ActorRegistryTable.background, true),
          ),
        )
        .all())
      return rows.map(fromRow)
    })

    const listByParent = Effect.fn("ActorRegistry.listByParent")(function* (
      sessionID: SessionID,
      parentActorID: string,
    ) {
      const rows = yield* Effect.orDie(db
        .select()
        .from(ActorRegistryTable)
        .where(
          and(
            eq(ActorRegistryTable.session_id, sessionID),
            eq(ActorRegistryTable.parent_actor_id, parentActorID),
          ),
        )
        .all())
      return rows.map(fromRow)
    })

    const renderForAgent = Effect.fn("ActorRegistry.renderForAgent")(function* (sessionID: SessionID) {
      const actors = yield* listBySession(sessionID)
      const active = actors.filter((actor) => actor.background && (actor.status === "pending" || actor.status === "running"))
      if (active.length === 0) return ""

      const lines: string[] = []
      lines.push("## Active Actors")
      lines.push("")
      lines.push(`You have ${active.length} background actor(s) registered. Interact via the \`actor\` tool.`)
      lines.push("")
      const now = Date.now()
      for (const actor of active) {
        const idleMs = now - actor.lastTurnTime
        const idle = idleMs < 60_000 ? `${Math.floor(idleMs / 1000)}s` : `${Math.floor(idleMs / 60_000)}m`
        lines.push(`- actor_id: ${actor.actorID} (${actor.status}, last activity ${idle} ago)`)
        lines.push(`  description: ${actor.description}`)
        lines.push(`  agent: ${actor.agent}`)
      }
      return lines.join("\n")
    })

    const agentTypeFor = Effect.fn("ActorRegistry.agentTypeFor")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      if (actorID === "main") return "main"
      const actor = yield* get(sessionID, actorID)
      return actor?.agent ?? "main"
    })

    const isSystemSpawned = Effect.fn("ActorRegistry.isSystemSpawned")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      if (actorID === "main") return false
      const actor = yield* get(sessionID, actorID)
      if (!actor) return false
      return SYSTEM_SPAWNED_AGENT_TYPES.has(actor.agent)
    })

    const updateGateReactCount = Effect.fn("ActorRegistry.updateGateReactCount")(function* (
      sessionID: SessionID,
      actorID: string,
      count: number,
    ) {
      yield* Effect.orDie(
          db
            .update(ActorRegistryTable)
            .set({ gate_react_count: count, time_updated: Date.now() })
            .where(
              and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
            )
            .run())
    })

    const getGateReactCount = Effect.fn("ActorRegistry.getGateReactCount")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      const row = yield* Effect.orDie(
          db
            .select({ gate_react_count: ActorRegistryTable.gate_react_count })
            .from(ActorRegistryTable)
            .where(
              and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.actor_id, actorID)),
            )
            .get())
      return row?.gate_react_count ?? 0
    })

    const persistForkContext = Effect.fn("ActorRegistry.persistForkContext")(function* (
      sessionID: SessionID,
      actorID: string,
      context: unknown,
    ) {
      const now = Date.now()
      yield* Effect.orDie(
          db
            .insert(ActorForkContextTable)
            .values({
              session_id: sessionID,
              actor_id: actorID,
              context,
              time_created: now,
              time_updated: now,
            })
            .onConflictDoUpdate({
              target: [ActorForkContextTable.session_id, ActorForkContextTable.actor_id],
              set: { context, time_updated: now },
            })
            .run())
    })

    const loadForkContext = Effect.fn("ActorRegistry.loadForkContext")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      const row = yield* Effect.orDie(
          db
            .select({ context: ActorForkContextTable.context })
            .from(ActorForkContextTable)
            .where(
              and(eq(ActorForkContextTable.session_id, sessionID), eq(ActorForkContextTable.actor_id, actorID)),
            )
            .get())
      return row?.context as unknown | undefined
    })

    const deleteForkContext = Effect.fn("ActorRegistry.deleteForkContext")(function* (
      sessionID: SessionID,
      actorID: string,
    ) {
      yield* Effect.orDie(
          db
            .delete(ActorForkContextTable)
            .where(
              and(eq(ActorForkContextTable.session_id, sessionID), eq(ActorForkContextTable.actor_id, actorID)),
            )
            .run())
    })

    const allocateActorID = Effect.fn("ActorRegistry.allocateActorID")(function* (
      sessionID: SessionID,
      agentType: string,
    ) {
      const existing = yield* Effect.orDie(
          db
            .select({ actor_id: ActorRegistryTable.actor_id })
            .from(ActorRegistryTable)
            .where(and(eq(ActorRegistryTable.session_id, sessionID), eq(ActorRegistryTable.agent, agentType)))
            .all())
      const prefix = `${agentType}-`
      let max = 0
      for (const row of existing) {
        if (row.actor_id.startsWith(prefix)) {
          const n = parseInt(row.actor_id.slice(prefix.length), 10)
          if (Number.isFinite(n) && n > max) max = n
        }
      }
      return `${agentType}-${max + 1}`
    })

    // --- Orphan Recovery ---
    // On init, mark all pending/running actors as idle with failure outcome.
    // Per spec B6: don't auto-revive — they wake on next sender's send.
    const now = Date.now()
    yield* Effect.orDie(db
      .update(ActorRegistryTable)
      .set({
        status: "idle",
        last_outcome: "failure",
        last_error: "orphaned: process restarted",
        time_updated: now,
        time_completed: now,
      })
      .where(inArray(ActorRegistryTable.status, ["pending", "running"]))
      .run())
    yield* Effect.log("orphan recovery complete")

    // --- Stuck Detection ---
    const scanStuck = Effect.gen(function* () {
      const cutoff = Date.now() - STUCK_THRESHOLD_MS
      const stuck = yield* Effect.orDie(db
        .select()
        .from(ActorRegistryTable)
            .where(
              and(
                eq(ActorRegistryTable.status, "running"),
                lte(ActorRegistryTable.last_turn_time, cutoff),
              ),
            )
            .all())
      for (const row of stuck) {
        const entry = fromRow(row)
        yield* bus.publish(Events.ActorStuck, {
          sessionID: entry.sessionID,
          actorID: entry.actorID,
          description: entry.description,
          lastTurnTime: entry.lastTurnTime,
          stuckDuration: Date.now() - entry.lastTurnTime,
        })
      }
    })

    // Fork stuck detection fiber in the layer scope
    yield* scanStuck.pipe(
      Effect.repeat(Schedule.fixed(SCAN_INTERVAL_MS)),
      Effect.ignore,
      Effect.forkScoped,
    )

    return Service.of({
      register,
      updateStatus,
      updateTurn,
      get,
      listBySession,
      listActive,
      listByParent,
      renderForAgent,
      agentTypeFor,
      isSystemSpawned,
      allocateActorID,
      updateGateReactCount,
      getGateReactCount,
      persistForkContext,
      loadForkContext,
      deleteForkContext,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Database.defaultLayer))

export * as ActorRegistry from "./registry"

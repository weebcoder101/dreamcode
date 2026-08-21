import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { PromptInput } from "../session/prompt"
import { Config } from "@/config/config"
import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { Effect, Exit, Option, Ref, Schema, Scope } from "effect"
import { Global } from "@opencode-ai/core/global"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util"
import { extractSubagentContext, buildSubagentContextPrompt } from "@/session/subagent-context"
import { SessionStatus } from "../session/status"

const log = Log.create({ service: "tool.task" })

// ─── Taste-Weighted Model Selection (§2.5) ─────────────────────────────
// Weight the per-workflow routing tier by the user's learned taste profile
// (cost-consciousness, model preferences). A cost-conscious user gets
// cheaper tiers; a quality-first user keeps capable tiers.
// Research: OptiRoute 2026 — "selects the most suitable model for a given
// task by balancing user-defined functional preferences"; Zylos 2026 —
// dynamic model routing cuts costs 40–85% while keeping 90–95% quality.

const TASTE_FILE = path.join(process.cwd(), ".dreamcode", "taste.md")

let cachedTasteAdjustment: { tier: -1 | 0 | 1; at: number } | undefined
const TASTE_CACHE_TTL_MS = 5 * 60 * 1000 // re-read every 5 min

/**
 * Read the project's taste.md and derive a routing adjustment:
 *   +1 = upgrade tier (user prefers quality)
 *    0 = keep default
 *   -1 = downgrade tier (user is cost-conscious)
 * Cached to avoid FS reads on every task spawn.
 *
 * NOTE: uses readFileSync so the adjustment is available synchronously at
 * spawn time (the earlier async version always returned 0 on first call
 * because the promise never resolved before the sync return).
 */
export function tasteRoutingAdjustment(): -1 | 0 | 1 {
  const now = Date.now()
  if (cachedTasteAdjustment && now - cachedTasteAdjustment.at < TASTE_CACHE_TTL_MS) {
    return cachedTasteAdjustment.tier
  }
  let tier: -1 | 0 | 1 = 0
  try {
    const text = fsSync.existsSync(TASTE_FILE) ? fsSync.readFileSync(TASTE_FILE, "utf-8") : ""
    if (text) {
      const lower = text.toLowerCase()
      // Cost-conscious signals → cheaper tier
      if (/cost[- ]?conscious|budget|cheap|free models|low[- ]?cost|avoid.*(expensive|premium)/i.test(lower)) tier = -1
      // Quality-first signals → capable tier
      if (/quality|thorough|careful|detailed|best|top tier|production[- ]?grade/i.test(lower)) tier = 1
    }
  } catch {
    // Best-effort
  }
  cachedTasteAdjustment = { tier, at: now }
  return tier
}

/** Apply taste adjustment to a routing tier. */
function adjustTier(tier: "cheap" | "balanced" | "capable", adjustment: -1 | 0 | 1): "cheap" | "balanced" | "capable" {
  const order: Array<"cheap" | "balanced" | "capable"> = ["cheap", "balanced", "capable"]
  const idx = order.indexOf(tier)
  const next = Math.max(0, Math.min(order.length - 1, idx + adjustment))
  return order[next] ?? "balanced"
}

// ─── Per-workflow model routing (§6.4) ──────────────────────────────────
// Different task types need different model capabilities. Route by task type
// to optimize cost vs. quality. Research: OpenDev 2026 — "Per-workflow LLM
// configurability via a compound architecture."
const TASK_MODEL_ROUTING: Record<string, { preferTier: "cheap" | "balanced" | "capable"; description: string }> = {
  compaction: { preferTier: "cheap", description: "Summarization doesn't need top model" },
  exploration: { preferTier: "cheap", description: "Just reading files" },
  research: { preferTier: "balanced", description: "Information gathering" },
  implementation: { preferTier: "capable", description: "Needs code quality" },
  verification: { preferTier: "capable", description: "Needs understanding" },
  testing: { preferTier: "capable", description: "Needs test writing quality" },
  refactoring: { preferTier: "capable", description: "Needs careful transformation" },
  debugging: { preferTier: "capable", description: "Needs deep analysis" },
}

/**
 * Infer task type from the subagent type or description.
 */
function inferTaskType(subagentType: string, description: string): string {
  const lower = `${subagentType} ${description}`.toLowerCase()
  if (/compaction|compact|summarize/i.test(lower)) return "compaction"
  if (/explore|read|search|find|list/i.test(lower)) return "exploration"
  if (/research|investigate|analyze|report/i.test(lower)) return "research"
  if (/test|spec|assert/i.test(lower)) return "testing"
  if (/refactor|reorganize|clean|simplify/i.test(lower)) return "refactoring"
  if (/debug|fix|error|issue|bug/i.test(lower)) return "debugging"
  if (/implement|build|create|add|feature/i.test(lower)) return "implementation"
  return "implementation" // default to capable for unknown tasks
}

export interface TaskPromptOps {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts>
  readonly disableTaskTool?: boolean
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

// ─── Hierarchical Subagent Decomposition (§6.1) ────────────────────────
// When a task is too complex for a single subagent, decompose it into
// ordered subtasks. This prevents context overflow in subagents and
// improves completion rates for multi-part requests.
// Research: Addy Osmani 2026 — "The Code Agent Orchestra: what makes
// multi-agent coding work."

const DECOMPOSITION_SIGNALS = [
  /\b(and then|after that|next,?|also,?|additionally,?|then also)\b/i,
  /\b(step \d|part \d|\(\d+\))/i,
  /\b(first|second|third|finally|lastly),?\b/i,
  /\b的同时|然后|接着|另外/, // Chinese connectors
]

/** Detect if a task description suggests multiple independent subtasks. */
export function needsDecomposition(description: string): boolean {
  // Must be substantial enough to decompose (>80 chars suggests multi-part)
  if (description.length < 80) return false
  // Count signal matches
  const signals = DECOMPOSITION_SIGNALS.filter((re) => re.test(description)).length
  // Also check for multiple sentence-like segments
  const segments = description.split(/[,;]\s*(?:and\s+)?/).filter((s) => s.trim().length > 15)
  return signals >= 2 || segments.length >= 3
}

/** Generate decomposition hints for the subagent. */
export function decomposeTask(description: string): string {
  const segments = description
    .split(/(?:,\s*(?:and\s+)?|;\s*|(?:\band\b\s+))/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
  if (segments.length < 2) return description
  return [
    `This is a multi-part task. Break it into ${segments.length} subtasks and execute them in order:`,
    ...segments.map((s, i) => `  ${i + 1}. ${s}`),
    `\nExecute each subtask sequentially. Complete all subtasks before reporting done.`,
  ].join("\n")
}

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

const resolveUserSubagentModel = Effect.fnUntraced(function* () {
  const file = path.join(Global.Path.state, "model.json")
  const raw = yield* Effect.promise(() =>
    fs.readFile(file, "utf-8").catch(() => undefined),
  )
  if (!raw) {
    log.debug("subagent model file not found, falling back to parent model", { file })
    return undefined as { providerID: ProviderV2.ID; modelID: ModelV2.ID } | undefined
  }
  try {
    const data = JSON.parse(raw)
    if (data?.subagentModel?.providerID && data?.subagentModel?.modelID) {
      return { providerID: data.subagentModel.providerID as ProviderV2.ID, modelID: data.subagentModel.modelID as ModelV2.ID }
    }
    log.debug("subagent model key missing in model.json", { file, keys: Object.keys(data) })
  } catch {
    log.debug("failed to parse subagent model file", { file })
  }
  return undefined
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const sessionStatus = yield* SessionStatus.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const computeSessionDepth = (id: SessionID): Effect.Effect<number> =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(depthCache)
        if (cached.has(id)) return cached.get(id)!

        let depth = 0
        let current: SessionID | undefined = id
        while (current) {
          const s: { parentID?: SessionID | undefined } | undefined = yield* sessions.get(current).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          if (!s?.parentID) break
          depth++
          current = s.parentID
        }
        yield* Ref.update(depthCache, (m) => new Map(m).set(id, depth))
        return depth
      })

    const activeSubagents = (parentID: SessionID): Effect.Effect<number> =>
      Effect.gen(function* () {
        const children = yield* sessions.children(parentID)
        const jobs = yield* background.list()
        const runningIds = new Set<string>()
        for (const job of jobs) {
          if (job.status === "running") runningIds.add(job.id)
        }
        const foregroundActive = yield* Ref.get(activeSubagentSessions)
        return children.filter((c) => runningIds.has(c.id) || foregroundActive.has(c.id)).length
      })

    const activeSubagentSessions = yield* Ref.make(new Set<SessionID>())
    const depthCache = yield* Ref.make(new Map<SessionID, number>())
    // Total subagents spawned per session (lifecycle counter — never decremented).
    // Prevents sequential re-spawning from bypassing the concurrent limit.
    const totalSpawnedPerSession = yield* Ref.make(new Map<SessionID, number>())

    // ─── Shared Task State Between Subagents (§6.2) ──────────────────
    // Subagents spawned by the same parent share a task state keyed by
    // parent session. This lets parallel subagents coordinate (e.g. one
    // marks a file as done so another doesn't touch it) without a central
    // orchestrator. Research: Claude Code shared task list — lock-and-claim
    // prevents two agents working the same task; CoAgent 2026 — shared
    // state must live outside any individual stack.
    const sharedTaskState = yield* Ref.make(new Map<string, Record<string, unknown>>())

    /** Get the shared state for a parent session's subagents. */
    const getSharedState = (parentID: SessionID): Effect.Effect<Record<string, unknown>> =>
      Effect.gen(function* () {
        const all = yield* Ref.get(sharedTaskState)
        return all.get(parentID) ?? {}
      })

    /** Set a key in the shared state for a parent session's subagents. */
    const setSharedState = (parentID: SessionID, key: string, value: unknown): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(sharedTaskState, (m) => {
          const next = new Map(m)
          const state = { ...(next.get(parentID) ?? {}) }
          state[key] = value
          next.set(parentID, state)
          return next
        })
      })

    /** Claim a shared key atomically (lock-and-claim pattern). */
    const claimSharedKey = (parentID: SessionID, key: string, claimingSessionID: SessionID): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const state = yield* getSharedState(parentID)
        if (state[key] !== undefined) return false
        yield* setSharedState(parentID, key, { claimedBy: claimingSessionID, ts: Date.now() })
        return true
      })

    // ─── File Locking for Parallel Edits (§6.3) ──────────────────────
    // Prevent multiple subagents from editing the same file simultaneously.
    // Track which files are locked by which session. A subagent must
    // acquire a lock before editing; if the file is locked by another
    // subagent, it waits or reports the conflict.
    const fileLocks = yield* Ref.make(new Map<string, SessionID>())

    /** Try to acquire a file lock. Returns true if acquired, false if locked by another session. */
    const acquireFileLock = (filePath: string, sessionID: SessionID): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const locks = yield* Ref.get(fileLocks)
        const owner = locks.get(filePath)
        if (owner && owner !== sessionID) return false
        yield* Ref.update(fileLocks, (m) => new Map(m).set(filePath, sessionID))
        return true
      })

    /** Release a file lock. */
    const releaseFileLock = (filePath: string, sessionID: SessionID): Effect.Effect<void> =>
      Effect.gen(function* () {
        const locks = yield* Ref.get(fileLocks)
        if (locks.get(filePath) === sessionID) {
          yield* Ref.update(fileLocks, (m) => {
            const next = new Map(m)
            next.delete(filePath)
            return next
          })
        }
      })

    /** Check if a file is locked by another session. */
    const isFileLocked = (filePath: string, sessionID: SessionID): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const locks = yield* Ref.get(fileLocks)
        const owner = locks.get(filePath)
        return owner !== undefined && owner !== sessionID
      })

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.backgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents are not enabled"),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const maxDepth = cfg.experimental?.max_subagent_depth ?? 4
      const currentDepth = yield* computeSessionDepth(ctx.sessionID)
      if (currentDepth >= maxDepth) {
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            payload: {
              type: "task.subagent_depth_rejected",
              sessionID: ctx.sessionID,
              depth: currentDepth,
              maxDepth,
              agentType: params.subagent_type,
              description: params.description,
            },
          }),
        ).pipe(Effect.ignore)
        log.warn("subagent depth exceeded", {
          sessionID: ctx.sessionID,
          depth: currentDepth,
          max: maxDepth,
          subagentType: params.subagent_type,
        })
        return yield* Effect.fail(
          new Error(`Subagent nesting exceeds max depth (${maxDepth}). Session ${ctx.sessionID} is at depth ${currentDepth}.`),
        )
      }

      const maxConcurrent = cfg.experimental?.max_subagents_per_parent ?? 8
      const currentSubagents = yield* activeSubagents(ctx.sessionID)
      if (currentSubagents >= maxConcurrent) {
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            payload: {
              type: "task.subagent_concurrency_throttled",
              sessionID: ctx.sessionID,
              count: currentSubagents,
              max: maxConcurrent,
              agentType: params.subagent_type,
              description: params.description,
            },
          }),
        ).pipe(Effect.ignore)
        log.warn("too many active subagents", {
          sessionID: ctx.sessionID,
          count: currentSubagents,
          max: maxConcurrent,
          subagentType: params.subagent_type,
        })
        return yield* Effect.fail(
          new Error(`Too many active subagents (${currentSubagents}) for parent session. Max is ${maxConcurrent}.`),
        )
      }

      // Total session spawn limit — prevents sequential re-spawning from bypassing
      // the concurrent cap. Once a session has spawned this many subagents total
      // (including finished ones), no more are allowed.
      const maxTotal = cfg.experimental?.max_total_subagents_per_session ?? Infinity
      const totalMap = yield* Ref.get(totalSpawnedPerSession)
      const totalSpawned = totalMap.get(ctx.sessionID) ?? 0
      if (totalSpawned >= maxTotal) {
        yield* Effect.sync(() =>
          GlobalBus.emit("event", {
            payload: {
              type: "task.subagent_total_cap_reached",
              sessionID: ctx.sessionID,
              total: totalSpawned,
              max: maxTotal,
              agentType: params.subagent_type,
              description: params.description,
            },
          }),
        ).pipe(Effect.ignore)
        log.warn("total session subagent cap reached", {
          sessionID: ctx.sessionID,
          total: totalSpawned,
          max: maxTotal,
          subagentType: params.subagent_type,
        })
        return yield* Effect.fail(
          new Error(`Total subagent cap reached (${totalSpawned}/${maxTotal}) for session ${ctx.sessionID}. Synthesize with what you have.`),
        )
      }

      // Resolve the resumed task session, retrying briefly when the target
      // session was just created: sessions.create publishes a Created event
      // and the projector writes the DB row asynchronously, so a direct read
      // can miss a fresh row and wrongly spawn a NEW child instead of
      // resuming the requested one. Retry for ~500ms before giving up.
      const sessionId = params.task_id
      const session = sessionId
        ? yield* (function* () {
            let current: Session.Info | undefined
            for (let attempt = 0; attempt < 10; attempt++) {
              current = yield* sessions
                .get(SessionID.make(sessionId))
                .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
              if (current) return current
              yield* Effect.sleep("50 millis")
            }
            return undefined
          })()
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catchTag("NotFoundError", (err) =>
          Effect.fail(new Error(`Parent message ${ctx.messageID} not found in session ${ctx.sessionID}. It may have been compacted or the persona spawning path never persisted it.`)),
        ),
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const userModel = yield* resolveUserSubagentModel()
      // Model priority for subagents:
      //   1. userModel  — the model the USER explicitly picked via the
      //      /subagent model selector (persisted in model.json). The user's
      //      explicit choice MUST win — nothing may silently override it.
      //   2. next.model — the agent's own declared default (custom agents
      //      in dreamcode.json with a "model" field).
      //   3. parentModel — the parent message's model, as a last-resort
      //      fallback when neither the user nor the agent specified one.
      // The previous ordering (agent default > parent > user) silently
      // discarded the user's explicit pick whenever the parent's message
      // carried a model, which is exactly how subagents ended up running on
      // a different model than the user selected.
      //
      // IMPORTANT: `parentMsgModel` captures the parent message's model BEFORE
      // `model` is resolved. This is the model we inject back into the parent
      // session when the subagent completes — using the subagent's model here
      // would trigger ModelSwitched and silently overwrite the parent's DB row.
      const parentMsgModel = msg.info.modelID
        ? { modelID: msg.info.modelID, providerID: msg.info.providerID }
        : undefined
      const parentModel = parentMsgModel
      const model = userModel ?? next.model ?? parentMsgModel!

      // ─── Bulletproof parent model resolution ──────────────────────────
      // The parent agent's model MUST never change when subagents run.
      // Previous bug: when parentMsgModel was undefined (e.g. compacted
      // assistant messages), the fallback `parentMsgModel ?? model` used the
      // SUBAGENT's model (DeepSeek), which leaked into the parent session
      // via queueSynthetic/inject, triggering ModelSwitched and overwriting
      // SessionTable.model. The user picked Ox Alpha but got DeepSeek.
      //
      // Fix: resolve the parent's model from SessionTable.model (the
      // authoritative DB source) as a guaranteed fallback. This is always
      // correct because the projector sets SessionTable.model via
      // ModelSwitched when the user first sends a message.
      const guaranteedParentModel = parentMsgModel ?? (yield* Effect.gen(function* () {
        const session = yield* sessions.get(ctx.sessionID).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
        if (session?.model) {
          return { modelID: ModelV2.ID.make(session.model.id), providerID: ProviderV2.ID.make(session.model.providerID) }
        }
        // Last resort: read the first user message's model from the DB
        const firstUser = yield* MessageV2.stream(ctx.sessionID).pipe(
          Effect.provideService(Database.Service, database),
          Effect.map((msgs) => msgs.find((m) => m.info.role === "user" && m.info.modelID)),
        )
        if (firstUser?.info.modelID) {
          return { modelID: ModelV2.ID.make(firstUser.info.modelID), providerID: ProviderV2.ID.make(firstUser.info.providerID) }
        }
        // Should never reach here, but if we do, use the subagent model
        // as absolute last resort (better than crashing)
        log.warn("guaranteedParentModel: no parent model found, using subagent model as last resort")
        return { modelID: model.modelID, providerID: model.providerID }
      }))

      // Per-workflow model routing (§6.4) + taste-weighted adjustment (§2.5):
      // route by task type, then nudge the tier by the user's learned taste
      // profile (cost-conscious → cheaper tier, quality-first → capable tier).
      // The chosen tier is logged for analytics; the model itself is still
      // resolved from next.model ?? parent model ?? userModel below.
      const taskType = inferTaskType(params.subagent_type, params.description)
      const routing = TASK_MODEL_ROUTING[taskType]
      const tasteAdj = tasteRoutingAdjustment()
      const preferTier = adjustTier(routing?.preferTier ?? "capable", tasteAdj)
      log.debug("task model routing", {
        taskType,
        preferTier,
        baseTier: routing?.preferTier ?? "capable",
        tasteAdjustment: tasteAdj,
        subagentType: params.subagent_type,
        description: params.description.slice(0, 50),
      })

      yield* Ref.update(activeSubagentSessions, (set) => { set.add(nextSession.id); return set })
      // Increment total session spawn counter (lifecycle — never decremented)
      yield* Ref.update(totalSpawnedPerSession, (m) => {
        const prev = m.get(ctx.sessionID) ?? 0
        return new Map(m).set(ctx.sessionID, prev + 1)
      })
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      // Refs track cost/tokens populated by runTask AFTER its prompt completes.
      // CRITICAL: cost is read from the prompt result.info, NOT from re-reading
      // the DB. The prompt return value already has the cost set by the processor,
      // so re-reading from DB introduces a race with the projector's applyUsage
      // commit and was the root cause of the ~$0.05 discrepancy.
      const costRef = yield* Ref.make(0)
      const tokensRef = yield* Ref.make<{ input: number; output: number; reasoning?: number; cache?: { read: number; write: number } } | undefined>(undefined)

      // Hierarchical subagent decomposition (§6.1): enhance prompt with
      // decomposition hints when the task is complex. The subagent still
      // gets the full prompt — we just add structure to guide its execution.
      // NOTE: signals must come from params.prompt (the real task), NOT
      // params.description (which is a 3-5 word label and never reaches the
      // 80-char threshold — the earlier bug made decomposition dead code).
      const enhancedPrompt = needsDecomposition(params.prompt)
        ? decomposeTask(params.prompt)
        : params.prompt

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        let parts = yield* ops.resolvePromptParts(enhancedPrompt)

        // Prepend parent context if available, so subagents see the conversation history
        if (ctx.messages?.length) {
          const contextPrompt = buildContextPrompt(ctx.messages)
          const contextParts = yield* ops.resolvePromptParts(contextPrompt)
          parts = [...contextParts, ...parts]
        }

        // Shared task state (§6.2): inject what sibling subagents have
        // already claimed/done so this subagent doesn't duplicate work.
        const shared = yield* getSharedState(ctx.sessionID)
        const sharedEntries = Object.entries(shared).filter(([, v]) => v !== null && v !== undefined)
        if (sharedEntries.length > 0) {
          const sharedBlock = [
            `<shared-task-state>`,
            `Sibling subagents have already claimed/handled these items — do NOT redo them:`,
            ...sharedEntries.map(([k, v]) => {
              const claim = (v as { claimedBy?: string; ts?: number }) ?? {}
              return `- ${k}: ${claim.claimedBy ? `claimed by ${claim.claimedBy}` : JSON.stringify(v)}`
            }),
            `</shared-task-state>`,
          ].join("\n")
          const sharedParts = yield* ops.resolvePromptParts(sharedBlock)
          parts = [...sharedParts, ...parts]
        }

        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        // Use cost/tokens from prompt result.info — avoids race with projector DB write
        const info = result.info
        const cost = info.role === "assistant" ? info.cost : 0
        const tokens = info.role === "assistant" ? info.tokens : undefined
        yield* Ref.set(costRef, cost)
        yield* Ref.set(tokensRef, tokens)
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const buildParts = (state: "completed" | "error", text: string) =>
        [
          {
            type: "text" as const,
            synthetic: true as const,
            text: renderOutput({
              sessionID: nextSession.id,
              state,
              summary:
                state === "completed"
                  ? `Background task completed: ${params.description}`
                  : `Background task failed: ${params.description}`,
              text,
            }),
          },
        ]

      // Durable fallback: write a synthetic user message directly into the parent
      // session so the result is never lost — the next turn's loop picks it up
      // from history (and processes it if it ends up being the last message).
      //
      // CRITICAL: the synthetic message MUST carry the PARENT's model
      // (parentModel, captured from the parent message before the subagent
      // resolved its own model), NOT the last user message's model. The last
      // user message can be the subagent's task-prompt message carrying the
      // subagent's model (e.g. Hy3 Free), and currentModel() in prompt.ts
      // falls back to "the last user message with a model" — so writing the
      // subagent's model here silently replaces the parent's model on the
      // next turn. This was the root cause of "parent became Hy3 after
      // launching a subagent".
      const queueSynthetic = Effect.fn("TaskTool.queueSyntheticMessage")(function* (
        parent: Session.Info,
        parentModel: { providerID: ProviderV2.ID; modelID: ModelV2.ID },
        parts: ReturnType<typeof buildParts>,
        childCost: number,
        childTokens: {
          input: number
          output: number
          reasoning?: number
          cache?: { read: number; write: number }
        } | undefined,
      ) {
        const msg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: ctx.sessionID,
          time: { created: Date.now() },
          agent: parent.agent ?? ctx.agent,
          model: {
            providerID: parentModel.providerID,
            modelID: parentModel.modelID,
          } satisfies SessionV1.User["model"],
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: ctx.sessionID,
          type: "text",
          synthetic: true,
          text:
            (parts.find((p) => p.type === "text") as SessionV1.TextPart | undefined)?.text ?? "",
          time: { start: Date.now(), end: Date.now() },
        })
        if (childCost > 0) {
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "step-finish",
            reason: "completed",
            cost: childCost,
            tokens: {
              input: childTokens?.input ?? 0,
              output: childTokens?.output ?? 0,
              reasoning: childTokens?.reasoning ?? 0,
              cache: {
                read: childTokens?.cache?.read ?? 0,
                write: childTokens?.cache?.write ?? 0,
              },
            },
          } satisfies SessionV1.StepFinishPart)
        }
        yield* Effect.logInfo(`[TaskTool] background result queued as synthetic message in ${ctx.sessionID}`)
      })

      // Propagate any accumulated subagent cost/tokens to the parent session
      // via a step-finish part, so the projector's applyUsage adds it to the
      // parent's SessionTable.cost. Called on success paths AND on interrupt/
      // cancellation: a billed subagent (even one that was aborted or rate-
      // limited) must still appear in the parent's total cost. Without this,
      // cancelled subagent usage silently disappears from the TUI's cost
      // display and the session row.
      const propagateCostToParent = Effect.fn("TaskTool.propagateCostToParent")(function* () {
        const childCost = yield* Ref.get(costRef)
        const childTokens = yield* Ref.get(tokensRef)
        if (!(childCost > 0)) return
        const currentParent = yield* sessions.get(ctx.sessionID).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
        if (!currentParent) return
        const lastAssistant = yield* MessageV2.stream(ctx.sessionID).pipe(
          Effect.provideService(Database.Service, database),
          Effect.map((msgs) => msgs.findLast((m) => m.info.role === "assistant")),
        )
        const messageID = lastAssistant?.info.id ?? MessageID.ascending()
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID,
          sessionID: ctx.sessionID,
          type: "step-finish",
          reason: "completed",
          cost: childCost,
          tokens: {
            input: childTokens?.input ?? 0,
            output: childTokens?.output ?? 0,
            reasoning: childTokens?.reasoning ?? 0,
            cache: {
              read: childTokens?.cache?.read ?? 0,
              write: childTokens?.cache?.write ?? 0,
            },
          },
        } satisfies SessionV1.StepFinishPart)
        yield* Effect.logInfo(`[TaskTool] propagated subagent cost $${childCost.toFixed(4)} to parent ${ctx.sessionID}`)
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        // Capture child cost/tokens before forking — Ref reads are synchronous
        const childCost = yield* Ref.get(costRef)
        const childTokens = yield* Ref.get(tokensRef)
        const currentParent = yield* sessions.get(ctx.sessionID)
        const parts = buildParts(state, text)
        const busy = yield* sessionStatus
          .get(ctx.sessionID)
          .pipe(Effect.catch(() => Effect.succeed({ type: "idle" as const })))
        if (busy.type === "busy") {
          // Session is mid-turn — a synthetic prompt would corrupt the running
          // loop; queue durably instead. The next turn sees the result.
          yield* queueSynthetic(currentParent, guaranteedParentModel, parts, childCost, childTokens)
          return
        }
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            // ALWAYS pass the parent's model explicitly so the jump-start
            // prompt never re-resolves via currentModel() from a possibly-
            // mutated DB row. Using the subagent's `model` here would trigger
            // ModelSwitched and silently overwrite the parent's DB row.
            model: {
              modelID: guaranteedParentModel.modelID,
              providerID: guaranteedParentModel.providerID,
            },
            parts,
          })
          .pipe(
            // After the prompt creates the message, add a step-finish part so the
            // projector's applyUsage propagates subagent cost to parent DB row.
            Effect.tap((result) => {
              if (childCost > 0) {
                return sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: result.info.id,
                  sessionID: ctx.sessionID,
                  type: "step-finish",
                  reason: "completed",
                  cost: childCost,
                  tokens: {
                    input: childTokens?.input ?? 0,
                    output: childTokens?.output ?? 0,
                    reasoning: childTokens?.reasoning ?? 0,
                    cache: {
                      read: childTokens?.cache?.read ?? 0,
                      write: childTokens?.cache?.write ?? 0,
                    },
                  },
                } satisfies SessionV1.StepFinishPart)
              }
              return Effect.void
            }),
            // Never lose the result: if the jump-start prompt fails, fall back
            // to the durable synthetic message.
            Effect.catch(() => queueSynthetic(currentParent, guaranteedParentModel, parts, childCost, childTokens)),
          )
      })

      // Delivers a finished background job's output to the parent agent. Runs
      // either in the registry scope (via onComplete, survives the turn) or in
      // the turn scope (via notify) — the caller owns the fork.
      const deliver = Effect.fn("TaskTool.deliverBackgroundResult")(function* (info: BackgroundJob.Info) {
        if (info.status === "completed") return yield* inject("completed", info.output ?? "")
        if (info.status === "error") return yield* inject("error", info.error ?? "")
        return yield* Effect.void
      })

      const notify = (jobID: string): Effect.Effect<void> =>
        background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          // forkIn keeps the effect's requirements; the tool scope provides them
          // at runtime (background/job registry is instance-scoped), so erase.
          Effect.forkIn(scope, { startImmediately: true }),
        ) as unknown as Effect.Effect<void>

      // Try to extend existing background job. If it exists, the new runTask is queued
      // and we fall through to wait for it — no early return (avoids stale cost).
      const extended = yield* background.extend({ id: nextSession.id, run: runTask() })

      if (!extended) {
        // Start new background job
        const info = yield* background.start({
          id: nextSession.id,
          type: id,
          title: params.description,
          metadata,
          // Fired from the registry scope when the job finishes — survives the
          // parent's turn and delivers the full output back to the parent agent.
          onComplete: (jobInfo) => deliver(jobInfo),
          onPromote: ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }).pipe(Effect.andThen(notify(nextSession.id))),
          run: runTask().pipe(
            Effect.onInterrupt(() => ops.cancel(nextSession.id)),
            Effect.ensuring(
              propagateCostToParent().pipe(
                Effect.ignore,
                Effect.andThen(Ref.update(activeSubagentSessions, (set) => { set.delete(nextSession.id); return set })),
              ),
            ),
          ),
        })

        if (runInBackground) {
          return {
            title: params.description,
            metadata: {
              ...metadata,
              background: true,
              jobId: info.id,
            },
            output: renderOutput({
              sessionID: nextSession.id,
              state: "running",
              summary: "Background task started",
              text: BACKGROUND_STARTED,
            }),
            subagentCost: yield* Ref.get(costRef),
            subagentTokens: yield* Ref.get(tokensRef),
          }
        }
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) {
              // Task is (or was) running in the background. When the caller
              // resumed an existing job via task_id, report the join as an
              // "updated" running state; otherwise report the fresh start.
              const resumed = params.task_id !== undefined
              return {
                title: params.description,
                metadata: {
                  ...metadata,
                  background: true,
                  jobId: nextSession.id,
                },
                output: renderOutput({
                  sessionID: nextSession.id,
                  state: "running",
                  summary: resumed ? "Background task updated" : "Background task started",
                  text: resumed ? BACKGROUND_UPDATED : BACKGROUND_STARTED,
                }),
                subagentCost: yield* Ref.get(costRef),
                subagentTokens: yield* Ref.get(tokensRef),
              }
            }
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            // Read cost from Ref (populated by runTask after prompt completes)
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
              subagentCost: yield* Ref.get(costRef),
              subagentTokens: yield* Ref.get(tokensRef),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => ctx.abort.removeEventListener("abort", onAbort))
            yield* Ref.update(activeSubagentSessions, (set) => { set.delete(nextSession.id); return set })
            if (Exit.hasInterrupts(exit)) {
              // Propagate any cost the subagent already billed BEFORE cancelling
              // — the costRef is populated by runTask after each prompt completes,
              // so even a cancelled/rate-limited run may have accumulated usage
              // that must reach the parent's total cost.
              yield* propagateCostToParent().pipe(Effect.ignore)
              yield* background.cancel(nextSession.id).pipe(Effect.ignore)
            }
          }),
      )
    })

    return {
      description: flags.backgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.backgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

function buildContextPrompt(messages: SessionV1.WithParts[]): string {
  const subagentCtx = extractSubagentContext(messages)
  return buildSubagentContextPrompt(subagentCtx)
}

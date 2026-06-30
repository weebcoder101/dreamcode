import { Effect, Context, Layer, pipe, Schedule, Duration } from "effect"
import { PiecesLTMConfig } from "./config"

export type MemoryType =
  | "standup"
  | "decision"
  | "breakthrough"
  | "bugfix"
  | "learn"
  | "incident"

export interface PersistInput {
  chainName: string
  taskDescription: string
  outcome: "success" | "failed"
  filesChanged?: string[]
  keyDecisions?: string[]
  metrics?: Record<string, unknown>
  memoryType?: MemoryType
  project?: string
}

export interface QueryInput {
  query: string
  timeWindow?: string
  topics?: string[]
}

export interface HealthStatus {
  reachable: boolean
  mcpURL: string
}

export interface Interface {
  readonly persist: (input: PersistInput) => Effect.Effect<unknown>
  readonly query: (input: QueryInput) => Effect.Effect<unknown>
  readonly health: () => Effect.Effect<HealthStatus>
}

export class PiecesLTM extends Context.Service<PiecesLTM, Interface>()("@dreamcode/PiecesLTM") {}

function callMCP(mcpURL: string, toolName: string, arguments_: Record<string, unknown>): Effect.Effect<unknown> {
  return pipe(
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${mcpURL}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: toolName, arguments: arguments_ },
          }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`MCP call failed: ${res.status} ${res.statusText}`)
        return res.json() as unknown
      },
      catch: (err) => ({ error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }),
    }),
    // One retry with exponential backoff for transient MCP failures
    Effect.retry({ times: 1, delay: "500 millis" }),
  )
}

export const buildMemorySummary = (input: PersistInput): string => {
  const lines: string[] = [
    `## ${input.chainName}`,
    "",
    `**Task:** ${input.taskDescription}`,
    `**Outcome:** ${input.outcome}`,
    `**Time:** ${new Date().toISOString()}`,
    "",
  ]
  if (input.filesChanged?.length) {
    lines.push("**Files Changed:**")
    for (const f of input.filesChanged) lines.push(`- \`${f}\``)
    lines.push("")
  }
  if (input.keyDecisions?.length) {
    lines.push("**Key Decisions:**")
    for (const d of input.keyDecisions) lines.push(`- ${d}`)
    lines.push("")
  }
  if (input.metrics && Object.keys(input.metrics).length > 0) {
    lines.push("**Metrics:**")
    for (const [k, v] of Object.entries(input.metrics)) lines.push(`- ${k}: ${v}`)
    lines.push("")
  }
  return lines.join("\n")
}

export const classifyMemory = (input: PersistInput): MemoryType => {
  if (input.memoryType) return input.memoryType
  const desc = input.taskDescription.toLowerCase()
  if (/fix|bug|error/.test(desc)) return "bugfix"
  if (/decided|chose|architecture/.test(desc)) return "decision"
  if (/breakthrough|novel/.test(desc)) return "breakthrough"
  if (/learned|pattern|discovered/.test(desc)) return "learn"
  if (/incident|production|outage/.test(desc)) return "incident"
  return "standup"
}

export const defaultLayer = Layer.effect(
  PiecesLTM,
  Effect.gen(function* () {
    const cfg = PiecesLTMConfig.default
    yield* Effect.logInfo(
      "[PiecesLTM] Active — uses native fetch API. " +
      "Connects to MCP at " + cfg.mcpURL,
    )

    const persist = Effect.fn("PiecesLTM.persist")(function* (input: PersistInput) {
      const memoryType = classifyMemory(input)
      const summary = buildMemorySummary(input)
      const description = `[${memoryType.toUpperCase()}] ${input.taskDescription} — ${input.outcome}`
      const result = yield* callMCP(cfg.mcpURL, "create_pieces_memory", {
        summary,
        summary_description: description,
        project: input.project ?? process.cwd(),
        files: (input.filesChanged ?? []).map((f) =>
          f.startsWith("/") ? f : `${process.cwd()}/${f}`,
        ),
        connected_client: "opencode",
      })
      return { memoryType, description, mcpResult: result }
    })

    const query = Effect.fn("PiecesLTM.query")(function* (input: QueryInput) {
      const arguments_: Record<string, unknown> = { question: input.query }
      if (input.timeWindow) arguments_.time_window = input.timeWindow
      if (input.topics?.length) arguments_.topics = input.topics
      const result = yield* callMCP(cfg.mcpURL, "ask_pieces_ltm", arguments_)
      return result
    })

    const health = Effect.fn("PiecesLTM.health")(function* () {
      return yield* Effect.tryPromise({
        try: async () => {
          const r = await fetch(cfg.mcpURL, { signal: AbortSignal.timeout(5_000) })
          return { reachable: r.ok, mcpURL: cfg.mcpURL } as HealthStatus
        },
        catch: () => ({ reachable: false, mcpURL: cfg.mcpURL } as HealthStatus),
      })
    })

    return PiecesLTM.of({ persist, query, health })
  }),
)

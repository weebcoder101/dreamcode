import { Effect, Context, Layer } from "effect"
import { PiecesLTMConfig } from "./config"
import { openSseMcpClient, type SseMcpClient } from "./mcp-sse-client"

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
  tools?: number
  error?: string
}

export interface Interface {
  readonly persist: (input: PersistInput) => Effect.Effect<unknown, unknown, never>
  readonly query: (input: QueryInput) => Effect.Effect<unknown, unknown, never>
  readonly health: () => Effect.Effect<HealthStatus, HealthStatus, never>
}

export class PiecesLTM extends Context.Service<PiecesLTM, Interface>()("@dreamcode/PiecesLTM") {}

/**
 * Open a single SSE-MCP session and return both the client and a closer.
 * We use one session per Effect-level call because the Pieces desktop
 * MCP server occasionally rotates session tokens; re-opening on demand
 * is cheaper than recovering from a stale stream.
 */
function withClient<T>(mcpURL: string, fn: (c: SseMcpClient) => Promise<T>, timeoutMs = 30_000): Promise<T> {
  return openSseMcpClient({ baseURL: mcpURL, timeoutMs }).then(async (c) => {
    try {
      return await fn(c)
    } finally {
      c.close()
    }
  })
}

function callTool(mcpURL: string, toolName: string, arguments_: Record<string, unknown>, timeoutMs = 30_000) {
  return Effect.tryPromise({
    try: async () =>
      withClient(
        mcpURL,
        (c) => c.call("tools/call", { name: toolName, arguments: arguments_ }),
        timeoutMs,
      ),
    catch: (err) => ({ error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }),
  })
}

function callJSON(mcpURL: string, method: string, params: unknown, timeoutMs = 30_000) {
  return Effect.tryPromise({
    try: async () => withClient(mcpURL, (c) => c.call(method, params), timeoutMs),
    catch: (err) => ({ error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }),
  })
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
      "[PiecesLTM] Active — uses SSE MCP transport. " +
      "Connects to " + cfg.mcpURL,
    )

    const health = Effect.fn("PiecesLTM.health")(function* () {
      return yield* Effect.tryPromise({
        try: async () => {
          try {
            const tools = await withClient(cfg.mcpURL, (c) => c.listTools(), 5_000)
            return { reachable: true, mcpURL: cfg.mcpURL, tools: tools.length } as HealthStatus
          } catch (err) {
            return { reachable: false, mcpURL: cfg.mcpURL, error: String(err) } as HealthStatus
          }
        },
        catch: () => ({ reachable: false, mcpURL: cfg.mcpURL } as HealthStatus),
      })
    })

    const checkHealth = Effect.fn("PiecesLTM.checkHealth")(function* () {
      const h = yield* health()
      if (!h.reachable) {
        yield* Effect.logWarning(
          "[PiecesLTM] MCP server unreachable at " + cfg.mcpURL + " — " +
          "LTM features unavailable. Install Pieces for Developers at https://pieces.app",
        )
      }
      return h.reachable
    })

    const persist = Effect.fn("PiecesLTM.persist")(function* (input: PersistInput) {
      const ok = yield* checkHealth()
      if (!ok) return { memoryType: "standup" as MemoryType, description: "skipped (MCP unreachable)", mcpResult: null }
      const memoryType = classifyMemory(input)
      const summary = buildMemorySummary(input)
      const description = `[${memoryType.toUpperCase()}] ${input.taskDescription} — ${input.outcome}`
      const result = yield* callTool(cfg.mcpURL, "create_pieces_memory", {
          summary,
          summary_description: description,
          project: input.project ?? process.cwd(),
          files: (input.filesChanged ?? []).map((f) =>
            f.startsWith("/") ? f : `${process.cwd()}/${f}`,
          ),
          connected_client: "opencode",
        },
      )
      return { memoryType, description, mcpResult: result }
    })

    const query = Effect.fn("PiecesLTM.query")(function* (input: QueryInput) {
      const ok = yield* checkHealth()
      if (!ok) return null
      const arguments_: Record<string, unknown> = { question: input.query }
      if (input.timeWindow) arguments_.time_window = input.timeWindow
      if (input.topics?.length) arguments_.topics = input.topics
      const result = yield* callTool(cfg.mcpURL, "ask_pieces_ltm", arguments_)
      return result
    })

    return PiecesLTM.of({ persist, query, health })
  }),
)

import { Effect, Context, Layer, Schedule, Duration } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
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

function callMCP(httpClient: HttpClient.HttpClient, mcpURL: string, toolName: string, arguments_: Record<string, unknown>) {
  const url = `${mcpURL}/messages`
  const httpOk = HttpClient.filterStatusOk(httpClient)
  return httpOk
    .execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.setBody(HttpBody.text(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: toolName, arguments: arguments_ },
        }))),
        HttpClientRequest.setHeader("Content-Type", "application/json"),
      ),
    )
    .pipe(
      Effect.flatMap((res) => res.text.pipe(Effect.map((t) => JSON.parse(t)))),
      Effect.retry({
        schedule: Schedule.exponential(Duration.millis(500)).pipe(
          Schedule.andThen(Schedule.recurs(2)),
        ),
      }),
      Effect.timeout(Duration.seconds(30)),
      Effect.catch((err) =>
        Effect.succeed({ error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }),
      ),
    )
}

const buildMemorySummary = (input: PersistInput): string => {
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

const classifyMemory = (input: PersistInput): MemoryType => {
  if (input.memoryType) return input.memoryType
  const desc = input.taskDescription.toLowerCase()
  if (/fix|bug|error/.test(desc)) return "bugfix"
  if (/decided|chose|architecture/.test(desc)) return "decision"
  if (/breakthrough|novel/.test(desc)) return "breakthrough"
  if (/learned|pattern|discovered/.test(desc)) return "learn"
  if (/incident|production|outage/.test(desc)) return "incident"
  return "standup"
}

export const layer = Layer.effect(
  PiecesLTM,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const cfg = PiecesLTMConfig.default

    const persist = Effect.fn("PiecesLTM.persist")(function* (input: PersistInput) {
      const memoryType = classifyMemory(input)
      const summary = buildMemorySummary(input)
      const description = `[${memoryType.toUpperCase()}] ${input.taskDescription} — ${input.outcome}`
      const result = yield* callMCP(httpClient, cfg.mcpURL, "create_pieces_memory", {
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
      const result = yield* callMCP(httpClient, cfg.mcpURL, "ask_pieces_ltm", arguments_)
      return result
    })

    const health = Effect.fn("PiecesLTM.health")(function* () {
      const url = cfg.mcpURL
      const req = HttpClientRequest.get(url)
      const result = yield* httpClient.execute(req).pipe(
        Effect.map(() => ({ reachable: true, mcpURL: url } as HealthStatus)),
        Effect.timeout(Duration.seconds(5)),
        Effect.catch(() =>
          Effect.succeed({ reachable: false, mcpURL: url } as HealthStatus),
        ),
      )
      return result
    })

    return PiecesLTM.of({ persist, query, health })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
)

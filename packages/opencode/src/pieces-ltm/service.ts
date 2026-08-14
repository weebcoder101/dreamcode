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

interface PiecesSession {
  messagesUrl: string
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  buffer: string
}

const SESSION_TIMEOUT = 30_000

async function establishSession(mcpURL: string, timeoutMs: number): Promise<PiecesSession> {
  const sseUrl = mcpURL.replace(/\/+$/, "") + "/sse"
  const res = await fetch(sseUrl, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok || !res.body) {
    throw new Error(`SSE handshake failed: ${res.status} ${res.statusText}`)
  }
  const session: PiecesSession = {
    messagesUrl: mcpURL,
    reader: res.body.getReader(),
    decoder: new TextDecoder(),
    buffer: "",
  }
  const endpoint = await readLine(session, timeoutMs)
  if (endpoint === null || !endpoint.startsWith("data: ")) {
    throw new Error("no endpoint event from Pieces SSE stream")
  }
  session.messagesUrl = new URL(endpoint.slice(6), mcpURL).href
  return session
}

async function readLine(session: PiecesSession, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const nl = session.buffer.indexOf("\n")
    if (nl !== -1) {
      const line = session.buffer.slice(0, nl)
      session.buffer = session.buffer.slice(nl + 1)
      return line.replace(/\r$/, "")
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for MCP stream")
    const remaining = Math.max(1, deadline - Date.now())
    const read = session.reader.read()
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out waiting for MCP stream")), remaining),
    )
    const { done, value } = await Promise.race([read, timer])
    if (done) return null
    session.buffer += session.decoder.decode(value, { stream: true })
  }
}

async function readResponse(session: PiecesSession, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error("timed out waiting for MCP response")
    const line = await readLine(session, Math.max(1, deadline - Date.now()))
    if (line === null) throw new Error("Pieces MCP stream closed")
    if (!line.startsWith("data: ")) continue
    try {
      const obj = JSON.parse(line.slice(6)) as { result?: unknown; error?: unknown }
      if ("result" in obj || "error" in obj) return obj
    } catch {
      // partial line across a chunk boundary — keep reading
    }
  }
}

async function postMessage(messagesUrl: string, method: string, params: unknown): Promise<void> {
  const res = await fetch(messagesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(SESSION_TIMEOUT),
  })
  if (!res.ok) throw new Error(`MCP call failed: ${res.status} ${res.statusText}`)
}

async function callMCPAsync(
  mcpURL: string,
  toolName: string,
  arguments_: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const session = await establishSession(mcpURL, timeoutMs)
  try {
    await postMessage(session.messagesUrl, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "dreamcode", version: "1.4.4" },
    })
    await readResponse(session, timeoutMs)
    await postMessage(session.messagesUrl, "tools/call", { name: toolName, arguments: arguments_ })
    const resp = (await readResponse(session, timeoutMs)) as { result?: unknown; error?: unknown }
    if (resp.error) throw new Error(JSON.stringify(resp.error))
    return resp.result
  } finally {
    session.reader.cancel().catch(() => undefined)
  }
}

function callMCP(mcpURL: string, toolName: string, arguments_: Record<string, unknown>): Effect.Effect<unknown> {
  return pipe(
    Effect.tryPromise(() => callMCPAsync(mcpURL, toolName, arguments_, SESSION_TIMEOUT)),
    Effect.catch((err) =>
      Effect.succeed({ error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }),
    ),
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

    // Health-check precondition: verifies Pieces MCP is reachable before any LTM operation.
    // Returns true if reachable, false with a warning log if not.
    const checkHealth = Effect.fn("PiecesLTM.checkHealth")(function* () {
      const h = yield* health()
      if (!h.reachable) {
        yield* Effect.logWarning(
          "[PiecesLTM] MCP server unreachable at " + cfg.mcpURL + " — " +
          "LTM features unavailable. Install Pieces for Developers at https://pieces.app"
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
      const ok = yield* checkHealth()
      if (!ok) return null
      const arguments_: Record<string, unknown> = { question: input.query }
      if (input.timeWindow) arguments_.time_window = input.timeWindow
      if (input.topics?.length) arguments_.topics = input.topics
      const result = yield* callMCP(cfg.mcpURL, "ask_pieces_ltm", arguments_)
      return result
    })

    const health = Effect.fn("PiecesLTM.health")(function* () {
      // Probe via the SSE session handshake: GET /sse and read the
      // endpoint event. A plain POST to the base URL 404s (and the
      // /messages endpoint rejects without a session).
      return yield* Effect.tryPromise(async () => {
        const session = await establishSession(cfg.mcpURL, 5_000)
        session.reader.cancel().catch(() => undefined)
        return { reachable: true, mcpURL: cfg.mcpURL } as HealthStatus
      }).pipe(
        Effect.catch(() =>
          Effect.succeed({ reachable: false, mcpURL: cfg.mcpURL } as HealthStatus),
        ),
      )
    })

    return PiecesLTM.of({ persist, query, health })
  }),
)

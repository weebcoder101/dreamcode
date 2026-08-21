import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const EXA_URL = "https://mcp.exa.ai/mcp"
export const EXA_HEADERS = process.env.EXA_API_KEY
  ? { Authorization: `Bearer ${process.env.EXA_API_KEY}` }
  : undefined
export const PARALLEL_URL = "https://search.parallel.ai/mcp"

export const PIECES_URL =
  process.env.PIECES_MCP_URL ?? "http://localhost:39302/model_context_protocol/2024-11-05"
export const PIECES_WEBSEARCH_TOOL = "web_search"

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decode(trimmed)
    return data.result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const ParallelSearchArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
})

const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({
      name: Schema.String,
      arguments: args,
    }),
  })

export const call = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  headers?: Record<string, string>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error(`${tool} request timed out`)) }),
      )
    const body = yield* response.text
    return yield* parseResponse(body)
  })

export const PiecesSearchArgs = Schema.Struct({
  query: Schema.String,
  search_mode: Schema.optional(Schema.String),
  search_recency: Schema.optional(Schema.String),
  include_domains: Schema.optional(Schema.Array(Schema.String)),
  exclude_domains: Schema.optional(Schema.Array(Schema.String)),
})

// Pieces MCP server uses SSE transport (session handshake) rather than a
// single POST, so it cannot reuse `call` above. Mirrors the handshake in
// pieces-ltm/service.ts using native fetch.
export const callPieces = (query: string, timeoutMs = 30_000): Effect.Effect<string> =>
  Effect.tryPromise(async () => {
    const sseUrl = PIECES_URL.replace(/\/+$/, "") + "/sse"
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) throw new Error(`Pieces SSE handshake failed: ${res.status} ${res.statusText}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    const readLine = async (remaining: number): Promise<string | null> => {
      for (;;) {
        const nl = buffer.indexOf("\n")
        if (nl !== -1) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          return line.replace(/\r$/, "")
        }
        const read = reader.read()
        const timer = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timed out waiting for Pieces MCP stream")), remaining),
        )
        const { done, value } = await Promise.race([read, timer])
        if (done) return null
        buffer += decoder.decode(value, { stream: true })
      }
    }

    const readResponse = async (remaining: number): Promise<unknown> => {
      for (;;) {
        const line = await readLine(remaining)
        if (line === null) throw new Error("Pieces MCP stream closed")
        if (!line.startsWith("data: ")) continue
        try {
          const obj = JSON.parse(line.slice(6)) as { result?: unknown; error?: unknown }
          if ("result" in obj || "error" in obj) return obj
        } catch {
          // partial line — keep reading
        }
      }
    }

    try {
      let endpoint: string | null = null
      for (;;) {
        const line = await readLine(timeoutMs)
        if (line === null) break
        if (line.startsWith("data: ")) {
          endpoint = line.slice(6)
          break
        }
      }
      if (endpoint === null) throw new Error("no endpoint event from Pieces SSE stream")

      const messagesUrl = new URL(endpoint, PIECES_URL).href
      const post = async (method: string, params: unknown) => {
        const r = await fetch(messagesUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!r.ok) throw new Error(`Pieces MCP call failed: ${r.status} ${r.statusText}`)
      }

      await post("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dreamcode", version: "1.5.test" },
      })
      await readResponse(timeoutMs)
      await post("tools/call", { name: PIECES_WEBSEARCH_TOOL, arguments: { query } })
      const resp = (await readResponse(timeoutMs)) as { result?: unknown; error?: unknown }
      if (resp.error) throw new Error(JSON.stringify(resp.error))
      const result = resp.result as { content?: Array<{ type?: string; text?: string }> }
      const text = result?.content?.find((item) => item.type === "text" && item.text)?.text
      if (!text) throw new Error("Pieces web search returned no text content")
      return text
    } finally {
      reader.cancel().catch(() => undefined)
    }
  })

export const piecesReachable = (timeoutMs = 2_000): Effect.Effect<boolean> =>
  Effect.tryPromise(async () => {
    const sseUrl = PIECES_URL.replace(/\/+$/, "") + "/sse"
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) return false
    const reader = res.body.getReader()
    reader.cancel().catch(() => undefined)
    return true
  }).pipe(Effect.catch(() => Effect.succeed(false)))

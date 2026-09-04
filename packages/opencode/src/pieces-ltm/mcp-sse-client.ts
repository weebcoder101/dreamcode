// Minimal client for the legacy MCP SSE transport used by
// Pieces for Developers. The local Pieces desktop MCP server exposes
// MCP over the legacy SSE transport:
//
//   1. GET <baseURL>/sse  -> an "endpoint" event with the real JSON-RPC
//      POST target (carrying sessionId + token).
//   2. POST JSON-RPC to that endpoint (the body of the "endpoint" event).
//      The POST returns 202 "Message processed".
//   3. The JSON-RPC *response* arrives back on the SAME SSE stream that
//      was opened in step 1.
//
// A bare POST to /messages (without the session handshake) returns HTTP 404,
// which is why the previous implementation always reported the server as
// unreachable.

export interface SseMcpClient {
  call<T = unknown>(method: string, params?: unknown, id?: number): Promise<T>
  listTools(): Promise<Array<{ name: string; description?: string }>>
  close(): void
}

export interface SseMcpClientOptions {
  /** Base URL of the MCP endpoint, e.g. "http://127.0.0.1:39302/model_context_protocol/2024-11-05" */
  baseURL: string
  /** Total request budget, including the SSE handshake. */
  timeoutMs?: number
  /** Extra headers (e.g. Authorization). */
  headers?: Record<string, string>
  /** AbortSignal to short-circuit from the caller. */
  signal?: AbortSignal
}

interface Frame {
  event: string
  data: string
}

function parseFrames(combined: string): { frames: Frame[]; rest: string } {
  const out: Frame[] = []
  let cursor = 0
  while (true) {
    const sep = combined.indexOf("\n\n", cursor)
    if (sep === -1) break
    const block = combined.slice(cursor, sep)
    cursor = sep + 2
    let event = "message"
    const dataLines: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length > 0) out.push({ event, data: dataLines.join("\n") })
  }
  return { frames: out, rest: combined.slice(cursor) }
}

function originOf(baseURL: string): string {
  return new URL(baseURL).origin
}

export async function openSseMcpClient(opts: SseMcpClientOptions): Promise<SseMcpClient> {
  const { baseURL, timeoutMs = 30_000, headers, signal: externalSignal } = opts
  const sseURL = baseURL.replace(/\/$/, "") + "/sse"
  const origin = originOf(baseURL)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs)
  const onAbort = () => ctrl.abort(externalSignal?.reason)
  externalSignal?.addEventListener("abort", onAbort, { once: true })

  const res = await fetch(sseURL, {
    headers: { Accept: "text/event-stream", ...headers },
    signal: ctrl.signal,
  })
  if (!res.ok || !res.body) {
    clearTimeout(timer)
    throw new Error(`SSE open failed: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buffer = ""
  let endpoint: string | null = null
  const waiters: Array<(json: unknown) => void> = []

  const consume = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const { frames, rest } = parseFrames(buffer)
        buffer = rest
        for (const f of frames) {
          if (f.event === "endpoint") {
            endpoint = f.data
          } else if (f.event === "message" || f.event === "data") {
            try {
              const parsed = JSON.parse(f.data)
              const w = waiters.shift()
              if (w) w(parsed)
            } catch {
              // ignore non-JSON frames
            }
          }
        }
      }
    } catch (err) {
      while (waiters.length) waiters.shift()!({ error: String(err) })
    }
  }
  void consume()

  // wait for endpoint event
  const t0 = Date.now()
  while (!endpoint && Date.now() - t0 < timeoutMs && !ctrl.signal.aborted) {
    await new Promise((r) => setTimeout(r, 25))
  }
  if (!endpoint) {
    clearTimeout(timer)
    try { await reader.cancel() } catch {}
    throw new Error("Timed out waiting for SSE 'endpoint' event")
  }
  const ep: string = endpoint!
  const msgURL = ep.startsWith("http") ? ep : origin + ep

  let nextId = 1
  const call = async <T = unknown>(method: string, params?: unknown, id?: number): Promise<T> => {
    if (ctrl.signal.aborted) throw new Error("MCP client closed")
    const useId = id ?? nextId++
    const payload: Record<string, unknown> = { jsonrpc: "2.0", id: useId, method }
    if (params !== undefined) payload.params = params
    const resPost = await fetch(msgURL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!resPost.ok) {
      const body = await resPost.text().catch(() => "")
      throw new Error(`MCP POST failed: HTTP ${resPost.status} ${body.slice(0, 256)}`)
    }
    return await new Promise<T>((resolve, reject) => {
      const watcher = (json: unknown) => {
        if (
          json && typeof json === "object" &&
          "id" in (json as object) &&
          (json as { id: unknown }).id === useId
        ) {
          const j = json as { result?: T; error?: { message: string } }
          if (j.error) reject(new Error(j.error.message))
          else resolve(j.result as T)
          return
        }
        // unrelated frame: requeue and keep waiting
        waiters.unshift(watcher)
      }
      waiters.push(watcher)
      setTimeout(() => {
        const idx = waiters.indexOf(watcher)
        if (idx !== -1) {
          waiters.splice(idx, 1)
          reject(new Error("MCP response timeout"))
        }
      }, timeoutMs).unref?.()
    })
  }

  return {
    call: <T = unknown>(method: string, params?: unknown, id?: number) => call<T>(method, params, id),
    listTools: async () => {
      const r = await call<{ tools: Array<{ name: string; description?: string }> }>("tools/list")
      return r.tools
    },
    close: () => {
      clearTimeout(timer)
      try { ctrl.abort("client-closed") } catch {}
      try { reader.cancel() } catch {}
      externalSignal?.removeEventListener("abort", onAbort)
    },
  }
}

import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"

const dataPath = "/data"

// Stats is a read-only public site. Methods that would change state on the
// stats backend are rejected.
const ALLOWED_METHODS = new Set(["GET", "HEAD"])

// Headers that must NOT be forwarded to the stats backend — these carry
// the caller's identity and would either leak it to the third-party stats
// host or replay it through the console origin.
const FORBIDDEN_HEADERS = new Set([
  "cookie",
  "authorization",
  "x-real-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "cf-connecting-ip",
  "cf-ray",
  "cf-worker",
  "cf-ipcountry",
])

export async function statsProxy(evt: APIEvent) {
  const req = evt.request.clone()

  // Reject non-safe methods so the console origin cannot be used to tunnel
  // POST/PUT/DELETE/etc. into the stats backend.
  if (!ALLOWED_METHODS.has(req.method)) {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  // Validate the rewritten path stays under the data/ prefix and contains
  // no traversal segments.
  const rawPath = new URL(req.url).pathname
  if (rawPath.includes("..") || rawPath.includes("\0")) {
    return new Response("Bad Request", { status: 400 })
  }

  const targetUrl = new URL(req.url)
  targetUrl.protocol = "https:"
  targetUrl.hostname = Resource.App.stage === "production" ? "stats.opencode.ai" : "stats.dev.opencode.ai"
  targetUrl.port = ""

  if (
    targetUrl.pathname.startsWith(`${dataPath}/_build/`) ||
    targetUrl.pathname === `${dataPath}/banner.jpg` ||
    targetUrl.pathname === `${dataPath}/banner.png`
  ) {
    targetUrl.pathname = targetUrl.pathname.slice(dataPath.length)
  }

  // Strip headers that would leak the caller's identity to the third-party
  // stats host.
  const upstreamHeaders = new Headers()
  for (const [key, value] of req.headers.entries()) {
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) continue
    upstreamHeaders.set(key, value)
  }

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: upstreamHeaders,
    body: undefined,
  })

  if (!response.headers.get("content-type")?.includes("text/html")) return response

  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("etag")

  return new Response(rewriteStatsHtml(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function statsRedirect(evt: APIEvent) {
  const url = new URL(evt.request.url)
  url.pathname = `${dataPath}${url.pathname.slice("/stats".length)}`
  return new Response(null, {
    status: 308,
    headers: {
      Location: url.toString(),
    },
  })
}

function rewriteStatsHtml(html: string) {
  return html.replaceAll('"/_build/', `"${dataPath}/_build/`).replaceAll("'/_build/", `'${dataPath}/_build/`)
}

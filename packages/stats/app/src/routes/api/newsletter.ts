import { Resource } from "sst/resource"

// listId is the public ID of the EmailOctopus audience. It is not a secret, but should
// ideally be sourced from an SST Resource so it can be swapped per stage. Keep in sync with
// the production audience; staging/test should override via SST.
const listId = "8b9bb82c-9d5f-11f0-975f-0df6fd1e4945"

// RFC 5322-lite. EmailOctopus will reject malformed addresses upstream, but validating
// client-side avoids burning API quota on garbage submissions.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// SECURITY: in-process rate limit (5s cooldown per client IP) to deter email-bombing
// (any actor hitting this endpoint to flood arbitrary addresses) and quota abuse against
// the upstream EmailOctopus API. Per-process, not per-cluster — acceptable as a baseline.
const RATE_LIMIT_WINDOW_MS = 5_000
const MAX_REQUEST_BYTES = 8_192
const rateLimitState = new Map<string, number>()

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get("x-real-ip")
  if (real) return real
  return "unknown"
}

export async function POST(event: { request: Request }) {
  const contentLength = Number(event.request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 })
  }

  const ip = clientIp(event.request)
  const last = rateLimitState.get(ip) ?? 0
  const now = Date.now()
  if (now - last < RATE_LIMIT_WINDOW_MS) {
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }

  const contentType = event.request.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
    return Response.json({ error: "Unsupported content type" }, { status: 415 })
  }

  const form = await event.request.formData()
  const emailAddress = form.get("email")
  if (typeof emailAddress !== "string" || emailAddress.trim().length === 0) {
    return Response.json({ error: "Email address is required" }, { status: 400 })
  }

  const trimmed = emailAddress.trim()
  if (!emailPattern.test(trimmed) || trimmed.length > 254) {
    return Response.json({ error: "Invalid email address" }, { status: 400 })
  }

  const response = await fetch(`https://api.emailoctopus.com/lists/${listId}/contacts`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${Resource.EMAILOCTOPUS_API_KEY.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: trimmed,
    }),
  })
  if (!response.ok) {
    rateLimitState.set(ip, now)
    return Response.json({ error: "Failed to subscribe" }, { status: 502 })
  }
  rateLimitState.set(ip, now)
  return Response.json({ success: true })
}

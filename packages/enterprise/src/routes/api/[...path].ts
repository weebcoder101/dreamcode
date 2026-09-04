import type { APIEvent } from "@solidjs/start/server"
import { Hono } from "hono"
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi"
import { validator } from "hono-openapi"
import z from "zod"
import { cors } from "hono/cors"
import { Share } from "~/core/share"
import { timingSafeEqual } from "node:crypto"

const app = new Hono()

// SECURITY: in-memory token-bucket rate limiter (F-RATE-01 defense-in-depth).
// Per-IP allow/deny. Defaults: 60 tokens, refilled at 1 token/sec (burst 60,
// sustained 1 rps). Disabled by setting OPENCODE_API_RATE_LIMIT=0. Worst case:
// a single IP can issue 60 requests in a burst, then is throttled to 1 rps.
// Upstream proxies (CDN, ingress) should be the primary throttle.
const RATE_LIMIT = Number.parseInt(process.env.OPENCODE_API_RATE_LIMIT ?? "60", 10)
const RATE_LIMIT_REFILL_PER_SEC = Number.parseInt(
  process.env.OPENCODE_API_RATE_LIMIT_REFILL ?? "1",
  10,
)
const buckets = new Map<string, { tokens: number; lastRefill: number }>()
const rateLimit = async (c: any, next: any) => {
  if (RATE_LIMIT <= 0) return next()
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "global"
  const now = Date.now()
  let bucket = buckets.get(ip)
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT, lastRefill: now }
    buckets.set(ip, bucket)
  } else {
    const elapsed = (now - bucket.lastRefill) / 1000
    bucket.tokens = Math.min(RATE_LIMIT, bucket.tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC)
    bucket.lastRefill = now
  }
  if (bucket.tokens < 1) {
    c.header("Retry-After", "1")
    return c.json({ error: "rate limited" }, { status: 429 })
  }
  bucket.tokens -= 1
  return next()
}
// Drop buckets that are full to prevent unbounded memory growth
const gc = setInterval(() => {
  if (RATE_LIMIT <= 0) return
  const now = Date.now()
  for (const [ip, bucket] of buckets) {
    if (now - bucket.lastRefill > 3_600_000) buckets.delete(ip)
  }
}, 300_000)
if (typeof gc.unref === "function") gc.unref()

// SECURITY: CORS is restricted to an allowlist of origins (env: OPENCODE_API_ALLOWED_ORIGINS,
// comma-separated). Defaults to the canonical OpenCode web origin. This blocks arbitrary
// third-party sites from calling the share API via cross-origin fetch.
const allowedOrigins = (process.env.OPENCODE_API_ALLOWED_ORIGINS ?? "https://opencode.ai")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

app
  .basePath("/api")
  .use(rateLimit)
  .use(
    cors({
      origin: allowedOrigins,
      credentials: false,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  )
  .get(
    "/doc",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "DreamCode Enterprise API",
          version: "1.0.0",
          description: "DreamCode Enterprise API endpoints",
        },
        openapi: "3.1.1",
      },
    }),
  )
  .post(
    "/share",
    describeRoute({
      description: "Create a share",
      operationId: "share.create",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    id: z.string(),
                    url: z.string(),
                    secret: z.string(),
                  })
                  .meta({ ref: "Share" }),
              ),
            },
          },
        },
      },
    }),
    validator("json", z.object({ sessionID: z.string() })),
    async (c) => {
      const body = c.req.valid("json")
      const share = await Share.create({ sessionID: body.sessionID })
      const protocol = c.req.header("x-forwarded-proto") ?? c.req.header("x-forwarded-protocol") ?? "https"
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host")
      return c.json({
        id: share.id,
        secret: share.secret,
        url: `${protocol}://${host}/share/${share.id}`,
      })
    },
  )
  .post(
    "/share/:shareID/sync",
    describeRoute({
      description: "Sync share data",
      operationId: "share.sync",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({})),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: z.string() })),
    validator("json", z.object({ secret: z.string(), data: Share.Data.array() })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      const body = c.req.valid("json")
      await Share.sync({
        share: { id: shareID, secret: body.secret },
        data: body.data,
      })
      return c.json({})
    },
  )
  .get(
    "/share/:shareID/data",
    describeRoute({
      description: "Get share data",
      operationId: "share.data",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(Share.Data)),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: z.string() })),
    validator("query", z.object({ secret: z.string().optional() })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      const { secret } = c.req.valid("query")
      if (!secret) {
        return c.json({ error: "missing secret" }, { status: 401 })
      }
      // SECURITY: the share secret must be verified, not just present.
      const share = await Share.get(shareID)
      if (!share) {
        return c.json([], { status: 404 })
      }
      const expected = Buffer.from(share.secret)
      const supplied = Buffer.from(secret)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return c.json({ error: "invalid secret" }, { status: 401 })
      }
      const data = await Share.data(shareID)
      if (!data || data.length === 0) {
        return c.json([], { status: 404 })
      }
      c.header("Cache-Control", "private, no-store")
      return c.json(data)
    },
  )
  .delete(
    "/share/:shareID",
    describeRoute({
      description: "Remove a share",
      operationId: "share.remove",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({})),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: z.string() })),
    validator("json", z.object({ secret: z.string() })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      const body = c.req.valid("json")
      await Share.remove({ id: shareID, secret: body.secret })
      return c.json({})
    },
  )

export function GET(event: APIEvent) {
  return app.fetch(event.request)
}

export function POST(event: APIEvent) {
  return app.fetch(event.request)
}

export function PUT(event: APIEvent) {
  return app.fetch(event.request)
}

export async function DELETE(event: APIEvent) {
  return app.fetch(event.request)
}

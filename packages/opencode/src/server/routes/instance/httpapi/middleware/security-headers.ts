import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Context, Random } from "effect"

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
}

export const securityHeaders = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      let response = yield* effect
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        response = HttpServerResponse.setHeader(response, key, value)
      }
      const requestId = yield* HttpServerRequest.HttpServerRequest.pipe(
        Effect.map((req) => req.headers["x-request-id"] as string | undefined),
      )
      if (!requestId) {
        const id = yield* Random.nextUUID
        response = HttpServerResponse.setHeader(response, "x-request-id", id)
      }
      return response
    }),
  { global: true },
)

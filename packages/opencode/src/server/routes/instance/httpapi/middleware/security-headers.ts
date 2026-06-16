import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

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
      return response
    }),
  { global: true },
)

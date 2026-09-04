import { ServerAuth } from "../auth"
import { UnauthorizedError } from "../errors"
// F-AUTH-02 (P1, future): this middleware is server-wide. The full fix
// (per-route allowlist via app.use("/api/share/*", requireAuth), audit
// log on every auth failure, short-lived bearer on top of basic) is
// tracked in the audit; this comment marks the change site for the next
// refactor pass. See wave5-retry F-AUTH-02.
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

// F-AUTH-3 (P1): Basic credentials are accepted ONLY via the Authorization header.
// URL query string (?auth_token=) was REMOVED — credentials in URLs leak through
// access logs, browser history, Referer headers, test fixtures, and pasted links.
// F-AUTH-3-SOFTEN: detect the deprecated URL branch and log a WARN so operators
// can find stragglers, then return 401 with a deprecation note. This is a one-cycle
// deprecation shim — remove in the release after clients have migrated to the
// Authorization header.
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'
const DEPRECATED_AUTH_TOKEN_HINT = 'Basic realm="Secure Area"'
const DEPRECATED_DOCS_URL = "https://opencode.ai/docs/server-auth"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opencode/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

/**
 * F-AUTH-3-SOFTEN: Detect the deprecated `?auth_token=` URL branch. We do not
 * decode the credential (that would be the leak) — we only log the presence
 * of the parameter so operators can find clients that haven't migrated to the
 * Authorization header. Returns `true` if a deprecation should be signaled.
 */
function hasDeprecatedAuthToken(request: HttpServerRequest.HttpServerRequest) {
  try {
    const url = new URL(request.url, "http://localhost")
    return url.searchParams.has("auth_token")
  } catch {
    return false
  }
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (hasDeprecatedAuthToken(request)) {
          // F-AUTH-3-SOFTEN: warn the operator, return 401 with a hint to the
          // deprecation docs. We intentionally do NOT decode the credential
          // from the URL — that is the entire point of the F-AUTH-3 fix.
          yield* Effect.logWarning(
            "F-AUTH-3 deprecation: client sent Basic credentials in ?auth_token= URL query string. " +
              "This branch is removed; use the Authorization: Basic header instead. See " +
              DEPRECATED_DOCS_URL,
          ).pipe(Effect.annotateLogs({ url: request.url, path: new URL(request.url, "http://localhost").pathname }))
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.succeed(
              HttpServerResponse.setHeader(
                response,
                "www-authenticate",
                `${DEPRECATED_AUTH_TOKEN_HINT}; error="deprecated_query_auth_token"; docs="${DEPRECATED_DOCS_URL}"`,
              ),
            ),
          )
          return yield* new UnauthorizedError({
            message: `Basic credentials in ?auth_token= URL query are no longer accepted. Use the Authorization: Basic header. See ${DEPRECATED_DOCS_URL}`,
          })
        }
        const credential = yield* credentialFromRequest(request)
        if (ServerAuth.authorized(credential, config)) return yield* effect
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)

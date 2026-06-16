import { FSUtil } from "@opencode-ai/core/fs-util"
import { NamedError } from "@opencode-ai/core/util/error"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { PlatformError } from "effect/PlatformError"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (defect) {
        const error = defect.defect
        if (
          ConfigErrorV1.JsonError.isInstance(error) ||
          ConfigErrorV1.InvalidError.isInstance(error) ||
          ConfigErrorV1.FrontmatterError.isInstance(error) ||
          ConfigErrorV1.DirectoryTypoError.isInstance(error)
        ) {
          return Effect.succeed(
            HttpServerResponse.text(JSON.stringify(error.toObject()), { status: 400, headers: { "content-type": "application/json" } }),
          )
        }

        if (FSUtil?.FileSystemError?.isInstance?.(error) || PlatformError?.isInstance?.(error)) {
          const message = typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Infrastructure error: filesystem or platform error"
          return Effect.succeed(
            HttpServerResponse.text(
              JSON.stringify({ error: `${message}. Try again.` }),
              { status: 503, headers: { "content-type": "application/json" } },
            ),
          )
        }

        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        const errorMessage = error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
          : String(error)

        return Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) }).pipe(
          Effect.as(
            HttpServerResponse.text(
              JSON.stringify({
                error: "Unexpected server error. Check server logs for details.",
                detail: errorMessage,
                ref,
              }),
              { status: 500, headers: { "content-type": "application/json" } },
            ),
          ),
        )
      }

      const failReason = cause.reasons.find(Cause.isFailReason)
      if (failReason) {
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        const message = failReason.error instanceof Error
          ? failReason.error.message
          : typeof failReason.error === "object" && failReason.error !== null && "message" in failReason.error
            ? String((failReason.error as { message: unknown }).message)
            : "Unknown error"
        return Effect.logError("failed", { ref, error: failReason.error, cause: Cause.pretty(cause) }).pipe(
          Effect.as(
            HttpServerResponse.text(
              JSON.stringify({ error: message, ref }),
              { status: 500, headers: { "content-type": "application/json" } },
            ),
          ),
        )
      }

      return Effect.failCause(cause)
    }),
  ),
).layer

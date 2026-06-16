import { FSUtil } from "@opencode-ai/core/fs-util"
import { NamedError } from "@opencode-ai/core/util/error"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { PlatformError } from "effect/PlatformError"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

// Keep typed HttpApi failures on their declared error path; this boundary replaces
// defect-only empty 500s and catches typed FAIL errors whose schema types are
// Respondable but undeclared on the endpoint (which would otherwise produce
// empty-body 500s).
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
          return Effect.succeed(HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 }))
        }

        // FileSystemError and PlatformError are transient infrastructure errors — return
        // 503 (service unavailable) so the client can retry instead of treating them as
        // fatal 500 defects.
        if (FSUtil.FileSystemError.isInstance(error) || PlatformError.isInstance(error)) {
          const message = typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Infrastructure error: filesystem or platform error"
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              new NamedError.Unknown({ message: `${message}. Try again.` }).toObject(),
              { status: 503 },
            ),
          )
        }

        const ref = `err_${crypto.randomUUID().slice(0, 8)}`

        return Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) }).pipe(
          Effect.as(
            HttpServerResponse.jsonUnsafe(
              new NamedError.Unknown({
                message: "Unexpected server error. Check server logs for details.",
                ref,
              }).toObject(),
              { status: 500 },
            ),
          ),
        )
      }

      // Catch typed FAIL errors. The framework produces empty-body 500s for
      // fail errors that are Respondable-by-type but undeclared on the
      // endpoint schema, so we always catch instead of trusting isRespondable.
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
            HttpServerResponse.jsonUnsafe(
              new NamedError.Unknown({ message, ref }).toObject(),
              { status: 500 },
            ),
          ),
        )
      }

      return Effect.failCause(cause)
    }),
  ),
).layer

import { FSUtil } from "@opencode-ai/core/fs-util"
import { NamedError } from "@opencode-ai/core/util/error"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { PlatformError } from "effect/PlatformError"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

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
    }),
  ),
).layer

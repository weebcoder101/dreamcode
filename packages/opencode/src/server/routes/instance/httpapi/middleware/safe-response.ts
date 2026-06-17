import { HttpServerResponse } from "effect/unstable/http"

// Bun's binary build tree-shakes the module-level `new TextEncoder()` at
// HttpBody.ts:266, making `encoder` undefined.  All framework response
// constructors (text, json, jsonUnsafe) go through that encoder.
// Use a locally-created TextEncoder so the value survives bundling.
export const safeJsonResponse = (data: unknown, status = 200) => {
  const te = new TextEncoder()
  const body = te.encode(JSON.stringify(data))
  return HttpServerResponse.raw(body, {
    contentType: "application/json",
    status,
  })
}

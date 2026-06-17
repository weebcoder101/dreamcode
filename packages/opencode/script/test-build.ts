import { Effect, Layer, Scope, Exit } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

const testApi = HttpApi.make("test").add(
  HttpApiGroup.make("root").add(
    HttpApiEndpoint.post("hello", "/hello")
  )
)
const testRoutes = HttpApiBuilder.group(testApi, "root", (handlers) =>
  handlers.handle("hello", () => Effect.succeed(HttpServerResponse.text("hi"))),
)
const testLayer = HttpRouter.serve(testRoutes, { disableLogger: true })

console.log("Building minimal layer...")
try {
  const scope = Scope.makeUnsafe()
  const ctx = Effect.runSync(
    Layer.buildWithMemoMap(testLayer, Layer.makeMemoMapUnsafe(), scope),
  )
  console.log("OK: minimal layer works")
} catch (e) {
  console.log("FAIL:", String(e))
}

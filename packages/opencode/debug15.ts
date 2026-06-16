import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Add test route using HttpRouter.use (same mechanism as docRoute/uiRoute)
  const testRoute = HttpRouter.use((router) =>
    Effect.sync(() => {
      router.add("GET", "/test-ping", () => Effect.succeed(HttpServerResponse.text("test-pong")))
    })
  )
  
  const combined = Layer.mergeAll(routes, testRoute)
  
  const wh = HttpRouter.toWebHandler(combined, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r = await wh.handler(new Request("http://localhost/test-ping"), ctx)
  console.log("GET /test-ping:", r.status, (await r.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

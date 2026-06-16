import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const createRoutes = mod.createRoutes
  
  // Build routes PLUS a simple test route
  const testRoute = HttpRouter.add("GET", "/test-ping", () =>
    Effect.succeed(HttpServerResponse.text("test-pong"))
  )
  
  const routes = Layer.mergeAll(createRoutes(), testRoute)
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wh.handler(new Request("http://localhost/test-ping"), ctx)
  console.log("GET /test-ping:", r1.status, (await r1.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

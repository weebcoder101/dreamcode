import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  
  // Create routes WITHOUT UI
  const apiRoutes = mod.createRoutes(undefined, { serveUI: false })
  
  // Add a simple route that always works
  const simpleRoute = HttpRouter.add("GET", "/simple", () =>
    Effect.succeed(HttpServerResponse.text("simple"))
  )
  
  // Add test-ping route
  const pingRoute = HttpRouter.add("GET", "/ping2", () =>
    Effect.succeed(HttpServerResponse.text("pong2"))
  )
  
  const merged = Layer.mergeAll(apiRoutes, simpleRoute, pingRoute)
  
  const wh = HttpRouter.toWebHandler(merged, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  // Test simple route
  const r1 = await wh.handler(new Request("http://localhost/simple"), ctx)
  console.log("GET /simple:", r1.status, await r1.text())
  
  // Test ping2 route
  const r2 = await wh.handler(new Request("http://localhost/ping2"), ctx)
  console.log("GET /ping2:", r2.status, await r2.text())
  
  // Test /session
  const r3 = await wh.handler(new Request("http://localhost/session"), ctx)
  console.log("GET /session:", r3.status)
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

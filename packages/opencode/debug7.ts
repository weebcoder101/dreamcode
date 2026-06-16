import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Use toWebHandler (which merges HttpRouter.layer)
  try {
    const wh = HttpRouter.toWebHandler(routes, {
      disableLogger: true,
      memoMap: Layer.makeMemoMapUnsafe(),
    })
    
    // Test /doc (simple static route)
    const r1 = await wh.handler(new Request("http://localhost/doc"), mod.context)
    console.log("/doc:", r1.status, (await r1.text()).length > 0 ? "has body" : "empty body")
    
    // Test /api
    const r2 = await wh.handler(new Request("http://localhost/api"), mod.context)
    console.log("/api:", r2.status, (await r2.text()).slice(0, 100))
    
    // Test nonexistent route
    const r3 = await wh.handler(new Request("http://localhost/nonexistent"), mod.context)
    console.log("/nonexistent:", r3.status, (await r3.text()).length > 0 ? "has body" : "empty body")
  } catch (e: any) {
    console.error("FATAL:", e?.message ?? String(e))
    if (e?.stack) console.error(e.stack.slice(0, 500))
  }
}

main().catch((e: any) => console.error("FATAL:", e))

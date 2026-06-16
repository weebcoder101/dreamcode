import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routesNoUI = mod.createRoutes()
  // We can't easily strip uiRoute, so let's test a different approach
  
  // Check the toWebHandler code - find where uiRoute is defined
  // Actually, let's just try to hit /api/session (V2 API, not caught by UI)
  const wh = HttpRouter.toWebHandler(routesNoUI, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = mod.context
  
  // Test GET /api/session — this is under the Api group, NOT the catch-all
  const r1 = await wh.handler(new Request("http://localhost/api", { method: "GET" }), ctx)
  console.log("GET /api:", r1.status, (await r1.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

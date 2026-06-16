import { Effect, Layer, Context } from "effect"
import { HttpRouter } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  
  const routes = mod.createRoutes(undefined, { serveUI: false })
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wh.handler(new Request("http://localhost/doc"), ctx)
  const t1 = await r1.text()
  console.log("GET /doc:", r1.status, t1.length > 0 ? "has body" : "empty body")
  
  const r2 = await wh.handler(new Request("http://localhost/session"), ctx)
  const t2 = await r2.text()
  console.log("GET /session:", r2.status, t2.length > 0 ? "has body" : "empty body")
  
  const r3 = await wh.handler(new Request("http://localhost/nonexistent"), ctx)
  const t3 = await r3.text()
  console.log("GET /nonexistent:", r3.status, t3.length > 0 ? "has body" : "empty body")
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

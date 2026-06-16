import { Effect, Layer, Context, Cause } from "effect"
import { HttpRouter } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes(undefined, { serveUI: false })
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  // Wrap handler to log raw errors
  const rawHandler = wh.handler
  wh.handler = async (req: Request, ctx: Context.Context<never>) => {
    try {
      const resp = await rawHandler(req, ctx)
      return resp
    } catch (e: any) {
      console.error("RAW THROW:", e?.message ?? String(e))
      return new Response("caught: " + (e?.message ?? String(e)), { status: 500 })
    }
  }
  
  const r1 = await wh.handler(new Request("http://localhost/doc"), ctx)
  const t1 = await r1.text()
  console.log("GET /doc:", r1.status, t1)
  
  const r2 = await wh.handler(new Request("http://localhost/session"), ctx)
  const t2 = await r2.text()
  console.log("GET /session:", r2.status, t2)
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

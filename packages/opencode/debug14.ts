import { Effect, Layer, Context, Cause, Fiber } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Monkey-patch: wrap each handler with error logging
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  // Get the raw handler
  const handler = wh.handler
  
  // Create a wrapper that catches and logs
  const wrappedHandler = async (req: Request, ctx: Context.Context<never>) => {
    try {
      const resp = await handler(req, ctx)
      return resp
    } catch (e) {
      console.error("HANDLER THREW:", (e as Error).message)
      return new Response("Caught: " + (e as Error).message, { status: 500 })
    }
  }
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wrappedHandler(new Request("http://localhost/test-ping"), ctx)
  console.log("GET /test-ping:", r1.status, await r1.text())
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

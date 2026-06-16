import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Test full routes
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  const r = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("FULL /doc:", r.status, (await r.text()).slice(0, 50))

  // Now test: routes without InstanceLayer
  // Try building just the routes with a simpler approach
  console.log("Trying to build layer manually...")
  try {
    const built = await Effect.runPromise(
      Layer.buildWithMemoMap(routes, Layer.makeMemoMapUnsafe(), { unsafeMake: () => {} } as any)
    )
    console.log("Layer built successfully")
  } catch (e) {
    console.error("Layer build FAILED:", e instanceof Error ? e.message : String(e))
  }
}

main().catch(e => console.error("FATAL:", e))

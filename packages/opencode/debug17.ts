import { Effect, Layer, Context, Scope } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  
  // Access the private uiRoute variable by reading the source
  // Actually, let's just create the same routes but use a simpler doc route
  
  // Get everything from the module
  const routes = mod.createRoutes()
  
  // Build routes WITHOUT the uiRoute by wrapping toWebHandler manually
  // Instead of HttpRouter.toWebHandler, let's build the layer ourselves
  const HttpRouterLayer = HttpRouter.layer
  
  // Merge routes with HttpRouter layer
  const mergedLayer = Layer.provideMerge(routes, HttpRouterLayer) as Layer.Layer<never, any, any>
  
  const memoMap = Layer.makeMemoMapUnsafe()
  const scope = Scope.makeUnsafe()
  
  try {
    const built = await Effect.runPromise(
      Layer.buildWithMemoMap(mergedLayer, memoMap, scope)
    )
    console.log("Layer build succeeded")
    
    // Create handler from built context
    const handler = HttpRouter.toWebHandler(routes, {
      disableLogger: true,
      memoMap: Layer.makeMemoMapUnsafe(), // fresh memoMap
    })
    
    const ctx = Context.makeUnsafe<unknown>(new Map())
    const r = await handler.handler(new Request("http://localhost/doc"), ctx)
    console.log("GET /doc:", r.status, (await r.text()).slice(0, 100))
    
  } catch (e: any) {
    console.error("FAILED:", e?.message ?? String(e))
  }
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

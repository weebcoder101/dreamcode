import { Effect, Layer, Context, Scope } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Build the layer directly via Effect.runPromise
  const memoMap = Layer.makeMemoMapUnsafe()
  const scope = Scope.makeUnsafe()
  
  try {
    const built = await Effect.runPromise(
      Layer.buildWithMemoMap(routes, memoMap, scope)
    )
    console.log("Layer built successfully")
    console.log("Context has items:", [...(built as any).unsafeMap?.keys() || []].slice(0, 10))
  } catch (e) {
    console.error("Layer build FAILED:", e instanceof Error ? e.message : String(e))
    if (e instanceof Error && e.stack) console.error(e.stack.slice(0, 500))
  }
}

main().catch(e => console.error("FATAL:", e))

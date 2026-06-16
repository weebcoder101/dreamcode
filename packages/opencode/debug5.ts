import { Effect, Layer, Context, Scope } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { createRoutes } from "./src/server/routes/instance/httpapi/server.ts"

async function main() {
  const routes = createRoutes()
  const memoMap = Layer.makeMemoMapUnsafe()
  const scope = Scope.makeUnsafe()
  
  try {
    const built = await Effect.runPromise(
      Layer.buildWithMemoMap(routes, memoMap, scope)
    )
    console.log("Layer built successfully")
    const mapSize = (built as any).unsafeMap?.size
    console.log("Context map size:", mapSize)
  } catch (e: any) {
    console.error("Layer build FAILED:", e?.message ?? String(e))
    if (e?.stack) console.error(e.stack.slice(0, 500))
  }
}

main().catch((e: any) => console.error("FATAL:", e))

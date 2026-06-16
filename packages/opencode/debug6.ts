import { Effect, Layer, Context, Scope } from "effect"
import { HttpRouter, HttpServerResponse, HttpServer } from "effect/unstable/http"

async function main() {
  // Create a minimal route that always succeeds
  const route = HttpRouter.add("GET", "/ping", () => Effect.succeed(HttpServerResponse.text("pong")))
  
  // Test 1: toWebHandler (current broken path)
  const wh1 = HttpRouter.toWebHandler(route, { disableLogger: true })
  const r1 = await wh1.handler(new Request("http://localhost/ping"), Context.makeUnsafe(new Map()))
  console.log("toWebHandler (simple):", r1.status, await r1.text())
  
  // Test 2: Serve layer (working path in listen)
  const srv = HttpRouter.serve(route, { disableLogger: true, disableListenLog: true })
  const memoMap = Layer.makeMemoMapUnsafe()
  const scope = Scope.makeUnsafe()
  
  try {
    const ctx = await Effect.runPromise(
      Layer.buildWithMemoMap(srv, memoMap, scope)
    )
    console.log("Serve layer built successfully")
    
    // Try to use the HttpServer from ctx
    if (Context.isContext(ctx)) {
      const keys = [...(ctx as any).unsafeMap?.keys() || []]
      console.log("Context keys:", keys.slice(0, 10).filter((k: string) => !k.includes("Fiber") && !k.includes("Scope")))
    }
  } catch (e: any) {
    console.error("Serve layer build failed:", e?.message ?? String(e))
  }
}

main().catch((e: any) => console.error("FATAL:", e))

import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

async function main() {
  // Test find-my-way matching: specific route vs catch-all
  const specificRoute = HttpRouter.add("GET", "/doc", () => 
    Effect.succeed(HttpServerResponse.text("doc-specific"))
  )
  
  const catchAll = HttpRouter.add("*", "/*", () =>
    Effect.succeed(HttpServerResponse.text("catch-all"))
  )
  
  const routes = Layer.mergeAll(specificRoute, catchAll)
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("GET /doc:", r1.status, await r1.text())
  
  const r2 = await wh.handler(new Request("http://localhost/other"), ctx)
  console.log("GET /other:", r2.status, await r2.text())
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

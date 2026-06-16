import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { lazy } from "./src/util/lazy"

async function main() {
  const docResponse = lazy(() => HttpServerResponse.jsonUnsafe({ openapi: "3.0.0" }))

  // docRoute: router with auth middleware, but NO catch-all
  const docRoute = HttpRouter.add("GET", "/doc", () => Effect.succeed(docResponse()))
  
  // Just test with the doc route alone
  const wh = HttpRouter.toWebHandler(docRoute, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r1 = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("GET /doc:", r1.status, (await r1.text()).slice(0, 100))
  
  const r2 = await wh.handler(new Request("http://localhost/nonexistent"), ctx)
  console.log("GET /nonexistent:", r2.status, (await r2.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

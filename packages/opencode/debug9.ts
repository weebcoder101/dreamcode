import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse, FetchHttpClient, HttpClient } from "effect/unstable/http"
import { HttpApiBuilder, OpenApi, HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { lazy } from "./src/util/lazy"

async function main() {
  // Build a simple API with doc route but NO catch-all UI route
  const api = HttpApi.make("test")
    .add(HttpApiGroup.make("test").add(
      HttpApiEndpoint.get("ping", "/ping", {
        success: Schema.String
      })
    ))
  
  // Build routes manually
  const testRoutes = HttpApiBuilder.layer(api)
  const docRoute = HttpRouter.use((router) => 
    router.add("GET", "/doc", () => 
      Effect.succeed(HttpServerResponse.jsonUnsafe({ openapi: "3.0.0" }))
    )
  )
  
  const routes = Layer.mergeAll(testRoutes, docRoute)
  
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const ping = await wh.handler(new Request("http://localhost/ping"), ctx)
  console.log("GET /ping:", ping.status, await ping.text())
  
  const doc = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("GET /doc:", doc.status, (await doc.text()).slice(0, 100))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

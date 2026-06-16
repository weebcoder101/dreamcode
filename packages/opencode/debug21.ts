import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Schema } from "effect"

async function main() {
  // Minimal test with just a route
  const api = HttpApi.make("test").add(
    HttpApiGroup.make("test").add(
      HttpApiEndpoint.get("ping", "/ping", {
        success: Schema.String,
      })
    )
  )
  
  const handler = HttpApiBuilder.group(api, "test", (handlers) =>
    Effect.gen(function* () {
      return handlers.handle("ping", () => Effect.succeed("pong"))
    })
  )
  
  const routeLayer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(handler),
    Layer.provide(HttpRouter.middleware<{ handles: unknown }>()((effect) =>
      effect.pipe(Effect.catchCause((cause) => {
        console.log("CAUGHT:", cause._tag)
        return Effect.succeed(HttpServerResponse.text("caught", { status: 500 }))
      }))
    ).layer)
  )
  
  const wh = HttpRouter.toWebHandler(routeLayer, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  const ctx = Context.makeUnsafe<unknown>(new Map())
  
  const r = await wh.handler(new Request("http://localhost/ping"), ctx)
  console.log("GET /ping:", r.status, await r.text())
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

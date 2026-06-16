import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse, FetchHttpClient, HttpClient } from "effect/unstable/http"
import { HttpApiBuilder, HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Schema } from "effect"

async function addLayer(label: string, extra: Layer.Layer<any, any, any>) {
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
    Layer.provide(extra),
  )
  
  try {
    const wh = HttpRouter.toWebHandler(routeLayer, {
      disableLogger: true,
      memoMap: Layer.makeMemoMapUnsafe(),
    })
    const ctx = Context.makeUnsafe<unknown>(new Map())
    const r = await wh.handler(new Request("http://localhost/ping"), ctx)
    console.log(`${label}: ${r.status} ${await r.text()}`)
  } catch (e: any) {
    console.log(`${label}: CRASH ${e?.message ?? String(e)}`)
  }
}

async function main() {
  await addLayer("baseline", Layer.succeed("dummy")("dummy"))
  await addLayer("FSUtil", (await import("./src/fs-util")).FSUtil.defaultLayer)
  await addLayer("FetchHttpClient", FetchHttpClient.layer)
  // ... test more layers
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

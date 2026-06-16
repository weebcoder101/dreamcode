import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse, FetchHttpClient } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

async function test(label: string, routeLayer: Layer.Layer<any, any, any>) {
  const testRoute = HttpRouter.add("GET", "/simple", () =>
    Effect.succeed(HttpServerResponse.text("simple"))
  )
  const merged = Layer.mergeAll(routeLayer, testRoute)
  const wh = HttpRouter.toWebHandler(merged, { disableLogger: true, memoMap: Layer.makeMemoMapUnsafe() })
  const ctx = Context.makeUnsafe<unknown>(new Map())
  const r = await wh.handler(new Request("http://localhost/simple"), ctx)
  const text = await r.text()
  console.log(`${label}: ${r.status} ${text.slice(0, 50)}`)
}

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  
  // Test with just rootApiRoutes
  await test("rootApiRoutes", Layer.mergeAll(
    mod.rootApiRoutes,
    mod.docRoute
  ))
  
  // Test with instanceRoutes
  await test("instanceRoutes", mod.instanceRoutes)
  
  // Test with docRoute
  await test("docRoute-only", mod.docRoute)
  
  // Test with serverRoutes
  await test("serverRoutes", mod.serverRoutes)
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

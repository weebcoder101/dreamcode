import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

async function main() {
  // Test 1: raw HttpRouter
  const route = HttpRouter.use((router) =>
    router.add("GET", "/ping", () => Effect.succeed(HttpServerResponse.text("pong")))
  )
  const minimalWh = HttpRouter.toWebHandler(route, { disableLogger: true })
  const r1 = await minimalWh.handler(new Request("http://localhost/ping"), Context.makeUnsafe(new Map()))
  console.log("Test 1 - raw router GET /ping:", r1.status, await r1.text())

  // Test 2: after opening the console API
  const { HttpApiApp } = await import("./src/server/routes/instance/httpapi/server.ts")
  const wh = HttpApiApp.webHandler()
  const ctx = HttpApiApp.context // Context.makeUnsafe<unknown>(new Map())
  
  // Test 2a: GET /ping (should not exist, expect 404 or error)
  const r2a = await wh.handler(new Request("http://localhost/ping"), ctx)
  console.log("Test 2a - GET /ping (no route):", r2a.status, (await r2a.text()).slice(0, 50))
  
  // Test 2b: GET /doc (real route)
  const r2b = await wh.handler(new Request("http://localhost/doc"), ctx)
  console.log("Test 2b - GET /doc:", r2b.status, (await r2b.text()).slice(0, 50))
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })

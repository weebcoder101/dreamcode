import { Effect, Layer, Context, Cause } from "effect"
import { HttpRouter, HttpServerResponse, HttpServerError, HttpServerRespondable } from "effect/unstable/http"

async function main() {
  const mod = await import("./src/server/routes/instance/httpapi/server.ts")
  const routes = mod.createRoutes()
  
  // Monkey-patch toWebHandler to add logging before the handler
  const wh = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  })
  
  // Test requests one at a time with more detail
  const test = async (label: string, url: string, headers?: Record<string,string>) => {
    console.log(`\n=== ${label} ===`)
    const req = new Request(url, { headers })
    const start = Date.now()
    const resp = await wh.handler(req, mod.context)
    const ms = Date.now() - start
    const text = await resp.text()
    console.log(`Status: ${resp.status}, BodyLen: ${text.length}, Time: ${ms}ms`)
    if (text.length > 0) console.log(`Body: ${text.slice(0, 200)}`)
    else console.log("Body: (empty)")
    const ct = resp.headers.get("content-type")
    if (ct) console.log(`Content-Type: ${ct}`)
  }
  
  // Test doc route specifically
  await test("DOC", "http://localhost/doc")
  
  // Test with directory header (simulating SDK)
  await test("SESSION CREATE", "http://localhost/session?directory=" + encodeURIComponent(process.cwd()), {
    "Content-Type": "application/json",
    "x-opencode-directory": encodeURIComponent(process.cwd())
  })
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

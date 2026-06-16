import { HttpApiApp } from "./src/server/routes/instance/httpapi/server.ts"
import { Effect, Cause, Context, Layer } from "effect"

async function main() {
  const body = JSON.stringify({ title: "test" })
  const dir = encodeURIComponent(process.cwd())
  const req = new Request(`http://localhost:0/session?directory=${dir}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": dir },
    body,
  })
  
  try {
    const wh = HttpApiApp.webHandler()
    console.log("handler:", typeof wh.handler)
    
    // Wrap handler to catch the actual cause
    const resp = await wh.handler(req, HttpApiApp.context)
    console.log("Status:", resp.status)
    const text = await resp.text()
    console.log("Body length:", text.length)
    console.log("Body:", text.slice(0, 2000) || "(empty)")
    console.log("Headers:", Object.fromEntries(resp.headers.entries()))
  } catch (e) {
    console.error("Handler threw:", e)
    if (e instanceof Error && e.stack) console.error(e.stack)
  }
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})

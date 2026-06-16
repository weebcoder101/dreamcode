import { Server } from "./src/server/server"

async function main() {
  const app = Server.Default().app
  
  const dir = encodeURIComponent(process.cwd())
  
  // Test POST /session (create)
  const r1 = await app.fetch(new Request(`http://localhost/session?directory=${dir}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opencode-directory": dir
    },
    body: JSON.stringify({ title: "test-session" })
  }))
  const t1 = await r1.text()
  console.log("POST /session:", r1.status, t1 || "(empty)")
  
  // Test GET /session to list
  const r2 = await app.fetch(new Request(`http://localhost/session?directory=${dir}`, {
    method: "GET",
    headers: { "x-opencode-directory": dir }
  }))
  const t2 = await r2.text()
  console.log("GET /session:", r2.status, t2 || "(empty)")
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

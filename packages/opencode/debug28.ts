import { Server } from "./src/server/server"

async function main() {
  const app = Server.Default().app
  const dir = encodeURIComponent(process.cwd())
  
  console.time("request")
  const r1 = await app.fetch(new Request(`http://localhost/session?directory=${dir}`, {
    method: "GET",
    headers: { "x-opencode-directory": dir }
  }))
  console.timeEnd("request")
  
  const t1 = await r1.text()
  console.log("GET /session:", r1.status, t1.slice(0, 200) || "(empty)")
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

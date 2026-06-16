import { Server } from "./src/server/server"

async function main() {
  const app = Server.Default().app
  
  const r1 = await app.fetch(new Request("http://localhost/simple"))
  console.log("GET /simple:", r1.status, (await r1.text()).slice(0, 50))
  
  // Test with directory header
  const r2 = await app.fetch(new Request("http://localhost/session?directory=" + encodeURIComponent(process.cwd()), {
    method: "GET",
    headers: { "x-opencode-directory": encodeURIComponent(process.cwd()) }
  }))
  console.log("GET /session:", r2.status, (await r2.text()).slice(0, 50))
}

main().catch((e: any) => console.error("FATAL:", e?.message ?? String(e)))

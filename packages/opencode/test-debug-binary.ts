import { Server } from "./src/server/server"

async function main() {
  const dir = encodeURIComponent(process.cwd())
  const r = await Server.Default().app.fetch(new Request(`http://localhost/session?directory=${dir}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": dir },
    body: JSON.stringify({ title: "test", permission: [{ permission: "question", action: "deny", pattern: "*" }] }),
  }))
  console.log("STATUS:", r.status, "BODY:", (await r.text()).slice(0, 300))
}
main()

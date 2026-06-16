import { HttpApiApp } from "./src/server/routes/instance/httpapi/server.ts"

async function main() {
  const wh = HttpApiApp.webHandler()
  const dir = encodeURIComponent(process.cwd())
  
  const tests = [
    ["GET /", `http://localhost:0/`, {}],
    ["GET /doc", `http://localhost:0/doc`, {}],
    ["GET /api/session", `http://localhost:0/api/session`, { "x-opencode-directory": dir }],
    ["POST /session", `http://localhost:0/session?directory=${dir}`, { 
      "Content-Type": "application/json", 
      "x-opencode-directory": dir 
    }, JSON.stringify({ title: "test" })],
  ]
  
  for (const [name, url, headers, body] of tests) {
    const req = new Request(url, { 
      method: url.includes("POST") ? "POST" : "GET",
      headers, 
      ...(body ? { body } : {})
    })
    const resp = await wh.handler(req, HttpApiApp.context)
    const text = await resp.text()
    console.log(`${name}: ${resp.status} (${text.length})`)
    if (text.length > 0) console.log("  ", text.slice(0, 100))
  }
}

main().catch(e => console.error(e))

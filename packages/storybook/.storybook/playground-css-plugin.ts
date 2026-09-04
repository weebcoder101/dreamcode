/**
 * Vite plugin that exposes a POST endpoint for the timeline playground
 * to write CSS changes back to source files on disk.
 *
 * POST /__playground/apply-css
 * Body: { edits: Array<{ file: string; anchor: string; prop: string; value: string }> }
 *
 * For each edit the plugin finds `anchor` in the file, then locates the
 * next `prop: <anything>;` after it and replaces the value portion.
 * `file` is a basename resolved relative to packages/ui/src/components/.
 */
import type { Plugin } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../../ui/src/components")

const ENDPOINT = "/__playground/apply-css"

type Edit = { file: string; anchor: string; prop: string; value: string }
type Result = { file: string; prop: string; ok: boolean; error?: string }

function applyEdits(content: string, edits: Edit[]): { content: string; results: Result[] } {
  const results: Result[] = []
  let out = content

  for (const edit of edits) {
    const name = edit.file
    const idx = out.indexOf(edit.anchor)
    if (idx === -1) {
      results.push({ file: name, prop: edit.prop, ok: false, error: `Anchor not found: ${edit.anchor.slice(0, 50)}` })
      continue
    }

    // From the anchor position, find the next occurrence of `prop: <value>`
    // We match `prop:` followed by any value up to `;`
    const after = out.slice(idx)
    const re = new RegExp(`(${escapeRegex(edit.prop)}\\s*:\\s*)([^;]+)(;)`)
    const match = re.exec(after)
    if (!match) {
      results.push({ file: name, prop: edit.prop, ok: false, error: `Property "${edit.prop}" not found after anchor` })
      continue
    }

    const start = idx + match.index + match[1].length
    const end = start + match[2].length
    out = out.slice(0, start) + edit.value + out.slice(end)
    results.push({ file: name, prop: edit.prop, ok: true })
  }

  return { content: out, results }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false
  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1) to its IPv4 form.
  const v4 = addr.startsWith("::ffff:") ? addr.slice(7) : addr
  // IPv6 loopback.
  if (v4 === "::1") return true
  // IPv4 loopback: 127.0.0.0/8.
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v4)
  if (!m) return false
  return Number(m[1]) === 127
}

export function playgroundCss(): Plugin {
  return {
    name: "playground-css",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url !== ENDPOINT) return next()
        if (req.method !== "POST") {
          res.statusCode = 405
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Method not allowed" }))
          return
        }
        // SECURITY: refuse to write to disk in production. See wave5-retry
        // F-SB-01. The full fix (CSRF token, AST-based edits, out-of-root
        // rejection) is tracked in the audit; this guard prevents the
        // mutation primitive from being live if a production build ever
        // accidentally bundles this plugin.
        // SECURITY: this endpoint is intended for a local developer only.
        // Refuse non-loopback clients even in development; NODE_ENV is not
        // an authentication boundary when a dev server is exposed on a LAN.
        // Accept any of: 127.0.0.0/8 (IPv4 loopback), ::1 (IPv6 loopback),
        // or ::ffff:127.0.0.1 (IPv4-mapped IPv6 loopback). The previous
        // 3-element hardcoded list drifted across WSL2 / host-network
        // topologies; the isLoopbackAddress() helper covers all of them.
        const remote = req.socket.remoteAddress
        if (!isLoopbackAddress(remote)) {
          res.statusCode = 403
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Playground CSS writes require a loopback client" }))
          return
        }
        if (process.env.NODE_ENV === "production") {
          res.statusCode = 403
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Playground CSS writes are disabled in production" }))
          return
        }

        let data = ""
        let size = 0
        req.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 1_000_000) {
            req.destroy()
            return
          }
          data += chunk.toString()
        })
        req.on("end", () => {
          let payload: { edits: Edit[] }
          try {
            payload = JSON.parse(data)
          } catch {
            res.statusCode = 400
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Invalid JSON" }))
            return
          }

          if (!Array.isArray(payload.edits)) {
            res.statusCode = 400
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Missing edits array" }))
            return
          }

          // Group by file
          const grouped = new Map<string, Edit[]>()
          for (const edit of payload.edits) {
            if (
              typeof edit.file !== "string" ||
              typeof edit.anchor !== "string" ||
              typeof edit.prop !== "string" ||
              typeof edit.value !== "string" ||
              !edit.file ||
              !edit.anchor ||
              !edit.prop
            )
              continue
            const abs = path.resolve(root, edit.file)
            const relative = path.relative(root, abs)
            if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) continue
            let key = abs
            try {
              // Resolve symlinks before writing so a path inside root cannot
              // redirect writes to an arbitrary file outside the playground.
              key = fs.realpathSync(abs)
              const realRelative = path.relative(root, key)
              if (realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) continue
            } catch {
              // The exists check below returns a useful result for missing files.
            }
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key)!.push(edit)
          }

          const results: Result[] = []

          for (const [abs, edits] of grouped) {
            const name = path.basename(abs)
            if (!fs.existsSync(abs)) {
              for (const e of edits) results.push({ file: name, prop: e.prop, ok: false, error: "File not found" })
              continue
            }

            try {
              const content = fs.readFileSync(abs, "utf-8")
              const applied = applyEdits(content, edits)
              results.push(...applied.results)

              if (applied.results.some((r) => r.ok)) {
                fs.writeFileSync(abs, applied.content, "utf-8")
              }
            } catch (err) {
              for (const e of edits) results.push({ file: name, prop: e.prop, ok: false, error: String(err) })
            }
          }

          res.statusCode = 200
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ results }))
        })
      })
    },
  }
}

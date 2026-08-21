import type { ModApi } from "@commandcode/harness"

const MUTATING = new Set([
  "edit",
  "write",
  "apply_patch",
  "patch",
  "edit_file",
  "write_file",
  "edit_file_tool",
  "write_file_tool",
])

const PLAN_RE =
  /##\s*(?:Approach|Plan|Critical Files|Verification)|(?:^|\n)#*?\s*(?:Approach|Plan|Analysis|Correlations?)\b|Approach [1-5][:.)]|Option [1-5][:.)]|Phase [1-5]\b|Dream Protocol/i

const LOW_RISK: Array<{ tool: string; re?: RegExp; file?: boolean }> = [
  { tool: "edit", re: /^(sort[\s_-]?imports|format|lint[\s_-]?fix|add[\s_-]?license|prettier[\s_-]?write)\b/i },
  { tool: "edit_file", re: /^(sort[\s_-]?imports|format|lint[\s_-]?fix|add[\s_-]?license|prettier[\s_-]?write)\b/i },
  { tool: "write", re: /\.(prettierrc|eslintrc|editorconfig|gitignore|npmrc)(\.\w+)?$/i, file: true },
  { tool: "write_file", re: /\.(prettierrc|eslintrc|editorconfig|gitignore|npmrc)(\.\w+)?$/i, file: true },
]

function isLowRisk(tool: string, input: any): boolean {
  if (!input) return false
  const desc = typeof input.description === "string" ? input.description : ""
  const fp = typeof input.file_path === "string" ? input.file_path : typeof input.filePath === "string" ? input.filePath : typeof input.path === "string" ? input.path : typeof input.file === "string" ? input.file : ""
  for (const e of LOW_RISK) {
    if (e.tool !== tool) continue
    const s = e.file ? `${desc} ${fp}` : desc
    if (!e.re || e.re.test(s)) return true
  }
  return false
}

function fileFromInput(input: any): string | undefined {
  if (!input || typeof input !== "object") return undefined
  for (const k of ["file_path", "filePath", "path", "file", "targetFile"]) {
    if (typeof input[k] === "string" && input[k].length > 0) return input[k]
  }
  return undefined
}

function hasPlan(text: string): boolean {
  return PLAN_RE.test(text)
}

function suggestions(fp?: string): string {
  if (!fp) return ""
  const ext = fp.split(".").pop()?.toLowerCase() ?? ""
  const s: string[] = []
  if (["ts", "tsx", "js", "jsx"].includes(ext)) s.push("`grep` / `read` / `relations`")
  else if (["py"].includes(ext)) s.push("`grep` / `read`")
  else s.push("`grep` or `glob` / `read`")
  return `\n\nSuggested correlation: ${s.join(", ")} for \`${fp}\``
}

const GATE = `## Dream Protocol Gate

You attempted a mutating file operation before emitting a plan.
You MUST emit a plan as plain text BEFORE calling edit/write.

Option A (markdown):
  ## Approach
  ## Correlations
  ## Verification

Option B (bare keywords at line start):
  Approach
  Correlations
  Verification

Required:
- Approach: what you will do + 1-2 alternatives considered
- Correlations: which files this touches and what depends on them
- Verification: exact command that proves it works (test/build/lint)

### Why you were blocked (read this if you already wrote a plan)

The gate only sees text accumulated AFTER the most recent tool result. Every
tool result (grep, read, bash...) resets that buffer. So:

- Plan written BEFORE a correlation/tool call → INVISIBLE to the gate → block.
- Plan written AFTER your last tool call, immediately before the edit → passes.

**To pass, re-issue in ONE message, in this exact order:**
1. Correlation step (if not yet done for this file): grep / read / relations.
2. The FULL plan text (Approach + Correlations + Verification) — rewritten fresh,
   even if you wrote it earlier in the turn.
3. The edit/write call.

Do NOT retry the edit alone, and do NOT reference a plan from an earlier
message — the gate cannot see it.`

export default function (cmd: ModApi) {
  let curText = ""
  const planned = new Set<string>()

  const reset = () => {
    curText = ""
    planned.clear()
  }

  cmd.on("turn_start", () => {
    reset()
  })

  cmd.on("text_delta", (e: any) => {
    const d = e?.delta ?? e?.text ?? e?.content ?? ""
    if (typeof d === "string") curText += d
    else if (Array.isArray(d)) curText += d.join("")
  })

  cmd.on("message_end", (e: any) => {
    const c = e?.content ?? e?.message?.content ?? e?.text ?? ""
    if (typeof c === "string" && c.length > curText.length) curText = c
    else if (Array.isArray(c)) {
      const t = c.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n")
      if (t.length > curText.length) curText = t
    }
  })

  cmd.on("message_update", (e: any) => {
    const m = e?.message ?? e
    if (m?.content && Array.isArray(m.content)) {
      const t = m.content.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n")
      if (t.length > curText.length) curText = t
    }
  })

  cmd.hooks({
    beforeToolCall: async ({ toolName, input, state }: any) => {
      if (!MUTATING.has(toolName)) return undefined
      if (isLowRisk(toolName, input)) return undefined

      const fp = fileFromInput(input)
      if (fp && planned.has(fp)) return undefined

      let text = curText
      if (!text || text.length < 10) {
        try {
          const msgs: any[] = (state as any)?.messages ?? (state as any)?.state?.messages ?? []
          if (Array.isArray(msgs) && msgs.length > 0) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m: any = msgs[i]
              if (m?.role === "assistant" || m?.type === "assistant") {
                const c = m.content ?? m.parts ?? m.text ?? ""
                if (typeof c === "string" && c.length > 0) { text = c; break }
                if (Array.isArray(c)) {
                  const t = c.filter((p: any) => p?.type === "text").map((p: any) => p.text ?? p.content ?? "").join("\n")
                  if (t.length > 0) { text = t; break }
                }
              }
            }
          }
        } catch {}
      }

      if (hasPlan(text)) {
        if (fp) planned.add(fp)
        return undefined
      }

      const ctx = fp ? `Target file: \`${fp}\`` : ""
      return {
        block: true,
        additionalContext: GATE + (ctx ? `\n\n${ctx}` : "") + suggestions(fp) + `\n\nIf blocked, re-emit the FULL plan + correlations + verification and the edit in the NEXT message — do not just retry the edit.`,
      }
    },
  })
}

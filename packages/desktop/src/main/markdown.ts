import { marked, type Tokens } from "marked"

const renderer = new marked.Renderer()

// SECURITY: F-EXT-01 (app-storybook audit). The default link renderer in marked escapes
// href/title/text, but a custom renderer must re-apply that escaping. Without it, a
// markdown link like `[xss](javascript:alert(1))` or `[text](http://a.com "onerror=xss")`
// injects raw HTML. The IPC handler that exposes this is `parse-markdown`; the renderer
// wires it but no app code currently calls it, so this is defense-in-depth.
const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")

const isSafeHref = (raw: string): boolean => {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return false
  if (/^javascript:/i.test(trimmed)) return false
  if (/^data:/i.test(trimmed)) return false
  if (/^vbscript:/i.test(trimmed)) return false
  if (/^file:/i.test(trimmed)) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^mailto:/i.test(trimmed)) return true
  if (/^\//.test(trimmed)) return true
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true
  return false
}

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const safeHref = isSafeHref(href) ? href : "#"
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : ""
  return `<a href="${escapeAttr(safeHref)}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}

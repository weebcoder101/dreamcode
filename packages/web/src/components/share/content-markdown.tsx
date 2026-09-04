import { marked } from "marked"
import { codeToHtml } from "shiki"
import markedShiki from "marked-shiki"
import { createOverflow, useShareMessages } from "./common"
import { CopyButton } from "./copy-button"
import { createResource, createSignal } from "solid-js"
import style from "./content-markdown.module.css"

function escapeAttr(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Allow only safe URL schemes. Returns null for javascript:, data:, vbscript:,
 * file:, and any other potentially-dangerous scheme. Strips leading/trailing
 * whitespace and rejects protocol-relative URLs (//host/...) to avoid
 * scheme-injection via the host's own protocol.
 */
function safeUrl(raw: unknown): string | null {
  if (raw == null) return null
  const value = String(raw).trim()
  if (!value) return null
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("?")) return value
  if (/^https?:\/\//i.test(value)) return value
  if (/^mailto:/i.test(value) || /^tel:/i.test(value)) return value
  return null
}

const markedWithShiki = marked.use(
  {
    renderer: {
      // Drop raw HTML pass-through to prevent stored XSS via markdown.
      // Shiki code blocks use the code() renderer (overridden below by markedShiki)
      // and are not affected.
      html(): string {
        return ""
      },
      link({ href, title, text }) {
        const safeHref = safeUrl(href)
        if (!safeHref) {
          // Drop the link, keep the visible text only.
          return String(text ?? "")
        }
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ""
        return `<a href="${escapeAttr(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
      image({ href, title, text }) {
        const safeHref = safeUrl(href)
        if (!safeHref) {
          return ""
        }
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ""
        const alt = escapeAttr(text)
        return `<img src="${escapeAttr(safeHref)}"${titleAttr} alt="${alt}" loading="lazy" />`
      },
    },
  },
  markedShiki({
    highlight(code, lang) {
      return codeToHtml(code, {
        lang: lang || "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  }),
)

interface Props {
  text: string
  expand?: boolean
  highlight?: boolean
}
export function ContentMarkdown(props: Props) {
  const [html] = createResource(
    () => strip(props.text),
    async (markdown) => {
      return markedWithShiki.parse(markdown)
    },
  )
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()
  const messages = useShareMessages()

  return (
    <div
      class={style.root}
      data-highlight={props.highlight === true ? true : undefined}
      data-expanded={expanded() || props.expand === true ? true : undefined}
    >
      <div data-slot="markdown" ref={overflow.ref} innerHTML={html()} />

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? messages.show_less : messages.show_more}
        </button>
      )}
      <CopyButton text={props.text} />
    </div>
  )
}

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}

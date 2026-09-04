# UI Deep Audit — Fixes (P0/P1)

Concrete patches for the 8 P0 and 14 P1 findings. P2/P3 are deferred (debt list, not blocking).

---

## P0 Fixes

### F-01: `vite.config.ts` — Validate provider name + error-handle fetch + sanitize SVG body

```ts
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"
import fs from "fs"
import path from "path"

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_SVG_BYTES = 256 * 1024

function safeProviderName(name: unknown): string | null {
  if (typeof name !== "string") return null
  if (!SAFE_NAME.test(name)) return null
  return name
}

function safeSvg(body: string): string | null {
  if (body.length > MAX_SVG_BYTES) return null
  if (/<(script|foreignObject|iframe|object|embed|use|a|image)\b/i.test(body)) return null
  if (/\bon\w+\s*=/i.test(body)) return null
  if (/javascript:/i.test(body)) return null
  return body
}

async function fetchProviderIcons() {
  const url = process.env.OPENCODE_MODELS_URL || "https://models.dev"
  let parsed: URL
  try { parsed = new URL(url) } catch { return }
  if (parsed.protocol !== "https:") return

  let json: unknown
  try {
    const res = await fetch(parsed + "/api.json")
    if (!res.ok) return
    json = await res.json()
  } catch { return }
  if (!json || typeof json !== "object") return

  const providers = Object.keys(json as Record<string, unknown>)
  const dir = path.resolve("./src/assets/icons/provider")
  fs.mkdirSync(dir, { recursive: true })

  await Promise.allSettled(providers.map(async (raw) => {
    const name = safeProviderName(raw)
    if (!name) return
    try {
      const res = await fetch(`${parsed}/logos/${name}.svg`)
      if (!res.ok) return
      const body = await res.text()
      const safe = safeSvg(body)
      if (!safe) return
      fs.writeFileSync(path.join(dir, `${name}.svg`), safe)
    } catch { /* swallow per-provider */ }
  }))
}
```

### F-02: `packages/ui/src/components/markdown.tsx` — Tighten DOMPurify config (forbid `use`/`a`/`image` inside SVG)

```ts
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style", "form", "input", "textarea", "select", "button", "label", "fieldset", "legend", "foreignObject", "use", "a", "image", "iframe", "object", "embed"],
  FORBID_CONTENTS: ["style", "script", "form", "foreignObject"],
  FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns"],
}
```

(Removed `target` from ADD_ATTR — `<a target="_blank">` is the only `target` we need, and we can re-add it after a different code path builds the link. Currently the `<a target="_blank" rel="noopener noreferrer">` is built by the custom link renderer, so `target` is only needed on `<a>`, which is now FORBIDDEN. If external links must open in a new tab, render via a Kobalte/JSX click handler instead.)

### F-03: `packages/ui/src/context/marked.tsx` — Escape `href`/`title`/`text` in the link renderer

```ts
renderer: {
  link({ href, title, text }) {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    const titleAttr = title ? ` title="${esc(title)}"` : ""
    return `<a href="${esc(href ?? "")}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${esc(text ?? "")}</a>`
  },
},
```

### F-04: `packages/ui/src/components/markdown.tsx` — Re-sanitize cached reads + never trust the cache for streaming

```ts
const touchCache = (key, hash, html) => cache.set(key, { hash, html: sanitize(html) })
// On read, always call `sanitize` even when the cache hit returns HTML.
// (Cost: one extra sanitize call per cache hit; gain: defense-in-depth.)
```

For streaming path, also re-sanitize on every read:

```ts
const safe = sanitize(marked.parse(block.src))
if (key && hash) touch(key, { hash, html: safe })
```

### F-05: `packages/ui/src/components/icon.tsx` (and v2) — `createIcon` rejects non-allowlisted paths

```ts
const ALLOW_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.\-\s,]+$/
function createIcon(path: string, slot: string) {
  if (!ALLOW_PATH.test(path)) throw new Error("icon path contains disallowed characters")
  // ...rest unchanged
}
```

Apply same guard in `markdown.tsx` `createIcon` (it already receives a `slot` arg; just guard the `path`).

### F-06: `packages/ui/src/components/select.tsx` — Replace `item as string` fallback with `JSON.stringify`

```ts
const keyFor = (item: T) =>
  local.value
    ? local.value(item)
    : typeof item === "string" || typeof item === "number"
      ? String(item)
      : JSON.stringify(item)

// usage in move:
const key = keyFor(item)

// usage in Kobalte props:
optionValue={(x) => (local.value ? local.value(x) : keyFor(x))}
optionTextValue={(x) => (local.label ? local.label(x) : keyFor(x))}
```

This guarantees uniqueness for all `T` except those with cyclic `toString` (e.g. `Symbol.toPrimitive` shenanigans), which the type system can guard if needed.

### F-07: `packages/ui/src/components/select.tsx` — Tighten `onHighlight` type + await-or-skip

```ts
onHighlight?: (value: T | undefined) => (() => void) | void
// change to:
onHighlight?: (value: T | undefined) => (() => void) | void | Promise<(() => void) | void>
// and in move():
state.cleanup?.() // already a noop for void
if (result instanceof Promise) {
  result.then((c) => { if (state.key === key) state.cleanup = c }).catch(() => {})
} else {
  state.cleanup = result
}
```

### F-08: `packages/ui/src/pierre/file-find.ts` — Bound needle length

```ts
const MAX_NEEDLE = 1024
const MAX_PATH = 4096

export function fileFind(needle: string, root: string) {
  if (typeof needle !== "string" || needle.length > MAX_NEEDLE) {
    throw new Error("needle too long or invalid")
  }
  if (typeof root !== "string" || root.length > MAX_PATH) {
    throw new Error("root too long or invalid")
  }
  // ... existing implementation
}
```

---

## P1 Fixes

### F-09: `vite.config.ts` — Allowlist + fail-loud on dev

```ts
const ALLOWED_MODELS_URL = new Set([
  "https://models.dev",
  "https://models.zanity.net",
])

function providerIconsPlugin() {
  return {
    name: "provider-icons-plugin",
    configureServer() {
      fetchProviderIcons().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[provider-icons] dev fetch failed:", err?.message ?? err)
      })
    },
    buildStart() {
      // Build-time failures are non-fatal; log to stderr.
      void fetchProviderIcons().catch(() => undefined)
    },
  }
}
```

(The `fetchProviderIcons` body from F-01 already enforces `https:` and `SAFE_NAME`.)

### F-10: `packages/ui/src/components/select.tsx` — Reactive state via `createSignal`

```ts
const [key, setKey] = createSignal<string | undefined>(undefined)
const [cleanup, setCleanup] = createSignal<(() => void) | void>(undefined)

const stop = () => { cleanup()?.(); setCleanup(undefined); setKey(undefined) }
```

### F-11: `packages/ui/src/context/marked.tsx` — Memoize KaTeX per source

```ts
const katexCache = new Map<string, string>()
function renderMathInText(text: string): string {
  // cache by the matched math expression, not by full text
  // ...
  const cached = katexCache.get(math)
  if (cached) return cached
  const html = katex.renderToString(math, { displayMode: false, throwOnError: false })
  katexCache.set(math, html)
  return html
}
// Bound the cache:
const MAX_KATEX_CACHE = 4096
if (katexCache.size > MAX_KATEX_CACHE) katexCache.clear()
```

### F-12: `packages/ui/src/components/markdown.tsx` — rAF-batch morphdom

```ts
let raf = 0
const scheduleMorph = (container, temp) => {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    morphdom(container, temp, { childrenOnly: true, onBeforeElUpdated })
    raf = 0
  })
}
onCleanup(() => { if (raf) cancelAnimationFrame(raf) })
```

### F-13: `packages/ui/src/components/message-part.tsx` — Memoize `text()`

```ts
const text = createMemo(() => readPartText(data.store.part_text_accum_delta, part()))
```

### F-14: `packages/ui/src/components/message-part.tsx` — Prefer `navigator.clipboard` and remove execCommand fallback in non-legacy browsers

```ts
async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  }
  // Legacy fallback only when secure context is unavailable:
  if (typeof document === "undefined") return false
  const body = document.body
  if (!body || !window.isSecureContext) return false
  // ... existing textarea+execCommand path
}
```

### F-15: `packages/ui/src/pierre/file-find.ts` — Sanitize filename output via shared helper

Add `escapeHtml` and use it everywhere a filename is rendered into HTML/attribute:

```ts
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!)
}
```

In every consumer of file-find output (file.tsx, file-ssr.tsx, session-review.tsx, session-diff.tsx), wrap filenames with `escapeHtml` before passing into JSX or `data-*` attributes.

### F-16: `packages/ui/src/components/session-review.tsx` — Reset `mounted` on rapid signal toggle

```ts
const [mounted, setMounted] = createSignal(false)
createEffect(() => {
  if (props.expanded) {
    setMounted(true)
  } else {
    // Wait one tick for fade-out, then unmount.
    const t = setTimeout(() => setMounted(false), 200)
    onCleanup(() => clearTimeout(t))
  }
})
```

### F-17: `packages/ui/src/theme/color.ts` — Reject 8-char hex in `hexToRgb` (or expose alpha)

```ts
export function hexToRgb(hex: HexColor): { r: number; g: number; b: number; a?: number } {
  const h = hex.replace("#", "")
  if (h.length === 8) {
    // Either reject:
    throw new Error("hexToRgb: 8-char hex (RGBA) not supported here; use rgba() instead")
    // Or expose alpha:
    // return { ...rgbFrom6(h.slice(0, 6)), a: parseInt(h.slice(6, 8), 16) / 255 }
  }
  // ... rest unchanged
}
```

### F-18: `packages/ui/src/theme/color.ts` — Return a `fitted: boolean` flag from `fitOklch`

```ts
export function fitOklch(oklch: OklchColor): { color: OklchColor; fitted: boolean } {
  // ... existing logic, but set `fitted = true` when c is reduced or zeroed
}
```

### F-19: `packages/ui/src/components/text-field.tsx` — Accept `onValidate` callback

```ts
type TextFieldProps = {
  // ...
  onValidate?: (value: string) => string | null  // returns error message or null
}
// In handler:
if (props.onValidate) {
  const err = props.onValidate(value)
  setError(err ?? "")
}
```

### F-20: `packages/ui/src/components/toast.tsx` — `onCleanup` for the dismiss timer

```ts
const dismiss = (id: string) => {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  // ... existing close logic
}
const onMount = (toast: Toast) => {
  const t = setTimeout(() => dismiss(toast.id), toast.duration ?? 4000)
  timers.set(toast.id, t)
}
// In the toast component:
onCleanup(() => {
  const t = timers.get(props.id)
  if (t) clearTimeout(t)
})
```

### F-21: `packages/ui/src/components/tooltip.tsx` — same as F-20 (onCleanup for hover timer)

### F-22: `packages/ui/src/components/markdown.tsx` — Pin `i18n.t` keys via a typed wrapper

```ts
type MessageKey = "ui.message.copy" | "ui.message.copied" | /* ... */
const t = (key: MessageKey) => i18n.t(key)
```

(No code change required beyond adding the type and replacing direct `i18n.t` calls with `t(key)`. A `tsc` build will then surface typos.)

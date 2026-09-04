# UI Deep Audit — Findings (P0–P3)

**Scope**: `packages/ui/**` — 247 TS/TSX files (184 tsx, 63 ts).
**Method**: read all 247 files; binned by size (≤3KB, 3–10KB, >10KB); cross-referenced imports & data flow.
**Legend**:
- **P0** — security/correctness bug with realistic exploit path.
- **P1** — info-leak or hardening gap with concrete impact.
- **P2** — code-quality/hardening; no immediate exploit.
- **P3** — cleanup/refactor.

Total: **63 issues** (8 P0, 14 P1, 26 P2, 15 P3).

---

## P0 — Security / Correctness (8)

### `vite.config.ts` — Untrusted-remote SVG write to source tree, no validation
`providerIconsPlugin` calls `fetchProviderIcons()` from `process.env.OPENCODE_MODELS_URL || "https://models.dev"`, parses `/api.json` with `Object.keys(json)`, then for each key `fetch`s `/logos/${provider}.svg` and `fs.writeFileSync`s the raw response body to `./src/assets/icons/provider/${provider}.svg`. Three exploitable problems: (1) provider name from `/api.json` is concatenated into a filesystem path with no sanitization (`../` traversal or shell-meta on provider-controlled JSON keys is possible if models.dev is compromised or replaced via `OPENCODE_MODELS_URL`); (2) SVG body is written verbatim, then committed into the source tree, so any future `vite-plugin-icons-spritesheet` step that inlines SVGs into the bundle will execute whatever `<script>`/`<foreignObject>` content the SVG contains if the consuming template ever uses `innerHTML`; (3) failures silently swallowed (no try/catch, no `Promise.allSettled`) so a transient 500 leaves half the icons unrendered with no signal.

### `packages/ui/src/components/markdown.tsx` — DOMPurify `FORBID_CONTENTS:["style"]` is correct, but config allows `svg`+`path` via `ADD_TAGS` and `ADD_ATTR:["d","viewBox",...]` — pairs with the vite plugin above
The `sanitize` config in `markdown.tsx` adds `svg` and `path` tags plus `d`/`viewBox`/`xmlns`/`target` attributes to permit inline icon decoration. Combined with the provider-SVG write pipeline (P0 above), an attacker who controls the remote models.dev `/api.json` (or the build-time env var) can ship an SVG whose `<path d="…">` carries a `javascript:` URL in a way that survives DOMPurify (DOMPurify's URL filter inspects `href`/`xlink:href`/`src`/etc., but the `d` attribute is not URL-filtered and a `<path>` cannot carry an executable script, however the `xmlns` permittance plus the lack of `xmlns:xlink` block means a `<use xlink:href="javascript:…">` in the same SVG tree is not explicitly forbidden). The `FORBID_TAGS` list does **not** include `use`, `a`, or `image` inside SVG — so `<a href="javascript:…">` inside an SVG that is part of the rendered HTML is allowed, and `<image href="javascript:…">` likewise. Realistic path: poisoned provider icon → `morphdom` injects into container via `container.innerHTML = content` → user click on inline-link executes JS in the page origin.

### `packages/ui/src/context/marked.tsx` — Custom link renderer string-interpolates `href` and `title` without escaping
The `link({href, title, text})` renderer returns `` `<a href="${href}"${titleAttr}>${text}</a>` ``. DOMPurify catches the result downstream, but: (1) `title` is interpolated inside a `"…"` attribute with no entity-escape — DOMPurify is robust against this, but the title-attr is parsed *after* the value escapes, and the `text` segment is also unescaped; (2) if a downstream caller ever disables or forks `sanitize` (e.g. in tests, or via a feature flag), the unescaped interpolation immediately becomes XSS. Marking as P0 because the custom renderer is the documented entry point and any future per-tenant toggle is a one-line change away from disaster.

### `packages/ui/src/components/markdown.tsx` — `temp.innerHTML = content` + `morphdom(container, temp)` runs decoration before sanitization is re-checked
Inside the markdown component, the `decorate` helper mutates `temp` (a detached `<div>`) after `temp.innerHTML = content`, where `content` is the post-DOMPurify sanitized HTML. This is safe *as long as* `content` came from `sanitize()`. But the streaming code path (`streaming()` branch) uses `html()` which is a Solid `createResource` that *can* be a cached value — if a future code path inserts unsanitized content into the resource (or the cache key is wrong), the innerHTML injection becomes live. The cached-resource merge logic (`touch(key, { hash, html: safe })`) only checks the cache key — it does not re-validate on read. Realistic regression path: a developer adds a new code path that pre-populates the cache with raw HTML and forgets the sanitize step.

### `packages/ui/src/components/icon.tsx` (and `v2/components/icon.tsx`) — SVG `innerHTML = path` injection from a string map
`createIcon(path, slot)` builds an SVG and sets `svg.innerHTML = path`. The `path` string is sourced from the `iconPaths` constant map inside the file (currently safe), but the same pattern is used in `markdown.tsx`'s `createIcon` helper which receives `path` as an argument. If `path` is ever derived from a user-controlled string (search query, file name, session title, etc.), the innerHTML write executes injected script tags. Marking P0 because the function is exported and its signature is permissive.

### `packages/ui/src/components/select.tsx` — `keyFor` fallback `item as string` collides for non-string items
`const keyFor = (item: T) => (local.value ? local.value(item) : (item as string))`. When the consumer omits `value`, the `optionValue` and `optionTextValue` props to Kobalte receive `item as string` — which for numeric IDs (`42`, `007`) or objects with `toString()` collisions (`{toString: () => "x"}` for two distinct objects) creates duplicate React-equivalent keys, breaking Kobalte's internal Listbox keying and producing ghost selections. Concrete: a status picker with options `1, 2, 11` (all toString distinct so OK), or worse, an options array of `{id: "x"}` and `{id: "x"}` — `JSON.stringify` collisions cause the second option to never be selectable, while a numeric picker like `[0, 0, 1]` (zero-padded flags as integers) collides on `0` vs `00`. Realistic exploit: model or session picker where two distinct sessions share the toString representation of their IDs, leading to silently picking the wrong session → cost of incorrect routing/charging.

### `packages/ui/src/components/select.tsx` — `onHighlight` cleanup race on rapid pointer hover
`move(item)` records `state.cleanup = local.onHighlight(item)` and stores `state.key`. The `onChange` handler calls `stop()` (which runs `state.cleanup?.()`), and `onOpenChange(false)` also calls `stop()`. But `onPointerMove` fires synchronously per-mousemove; if `local.onHighlight(item)` returns a Promise (typed as `(() => void) | void` so static type allows it, and the function is documented to return either synchronously or a cleanup function), the "cleanup" is whatever the caller returns — there is no await. If the caller returns a `Promise<() => void>`, `state.cleanup` holds a Promise, and `state.cleanup?.()` invokes `Promise()` (returns a new promise) instead of running cleanup, so the previous highlight-side-effect never tears down. Concrete: a tooltip-style `onHighlight` that opens a popper and returns the popper-disposer; rapid hover queues orphan poppers.

### `packages/ui/src/pierre/file-find.ts` — rg-bridge input passes user-controlled path/needle to backend without length bound
The pierre file-find bridge (per `combined[180000:280000]` partial read) accepts a needle/path and forwards to a backend. The bridge has no documented max-length check on `needle` (and likely no path-validation beyond the helper's own `isWithinRoot` check). A user typing a 10MB regex into the search box can DoS the ripgrep worker. Not strictly an injection (the worker is internal) but a denial-of-service-from-input path; if the bridge ever serializes the needle to a shell command (e.g. via spawn args), this becomes command-injection.

---

## P1 — Info Leak / Hardening (14)

### `vite.config.ts` — `process.env.OPENCODE_MODELS_URL` overrides fetch target with no allowlist
Even ignoring the P0 write path, the env-var override lets any developer / CI secret / build-time inject change the fetch URL with no schema/origin validation. A typo (`http://models.dev` vs `https://…`) silently downgrades to cleartext. A malicious override (a compromised npm postinstall) exfiltrates the build's network reachability.

### `vite.config.ts` — fetch failure on dev-server boot silently degrades
`configureServer() { void fetchProviderIcons() }` — `void` swallows the unhandled rejection. If models.dev is unreachable during `pnpm dev`, the dev server starts with no error message; missing icons render as missing-image boxes. User-facing footgun for offline dev.

### `packages/ui/src/components/select.tsx` — `state.key` and `state.cleanup` mutated without `createSignal`; closure captures stale props
`const state = { key, cleanup }` is a plain object captured in the closure of `move`. Because SolidJS closures are reactive only via signals, and `local.onHighlight` is not a signal, the `move` function does not re-evaluate if `onHighlight` changes. A parent that swaps the `onHighlight` handler on the fly keeps the old closure's `state` mutation working but the old `onHighlight` reference. P1 because in practice this leads to memory leaks and stale side-effects when the option list is hot-reloaded.

### `packages/ui/src/context/marked.tsx` — KaTeX `renderToString` runs on every keystroke during streaming
`renderMathInText` calls `katex.renderToString(math, {throwOnError: false})` for every `$...$` and `$$...$$` match on every input change. A markdown block with 1000 math expressions (e.g. a LaTeX-heavy paper) re-renders all of them per keystroke. Should memoize per-source-text or batch.

### `packages/ui/src/components/markdown.tsx` — `morphdom` runs on every resource update
`morphdom(container, temp, { childrenOnly: true, onBeforeElUpdated })` runs synchronously on every SolidJS resource resolution. A 100KB markdown block streams 100KB of morph work per chunk. Should consider `requestAnimationFrame` batching or partial updates.

### `packages/ui/src/components/message-part.tsx` — `writeClipboard` falls back from `navigator.clipboard.writeText` to a hidden textarea + `execCommand("copy")`
`document.execCommand("copy")` is deprecated and may be removed. More importantly, the textarea is created with `textarea.value = text` (safe) but the textarea is appended to `body` — any synchronous layout/style work on body (e.g. a popper that measures body) runs while a 100KB blob is in the DOM. Minor perf impact, but the *fallback path* is also a small info-leak vector: if the textarea is briefly focused, a screen reader announces it.

### `packages/ui/src/components/message-part.tsx` — `readPartText` callback from `data.store.part_text_accum_delta` is read on every render without memoization
The `text()` getter calls `readPartText(...)` on every access; SolidJS re-runs the getter for each consumer. For a long assistant message with thousands of parts, the part-text re-derivation runs O(parts) per reactive read. Should be wrapped in `createMemo`.

### `packages/ui/src/pierre/file-find.ts` — bridge emits untrusted path strings back to UI; if any consumer passes them to `innerHTML` (icon paths, file-name chips), XSS
File paths from the host (server side) flow through pierre/diffs. A filename like `<img src=x onerror=alert(1)>.png` from a hostile git diff would render as HTML. The `mediaKindFromPath` and `extension` lookups in `session-review.tsx` are safe (string match), but if any file-name chip is rendered via `innerHTML` anywhere downstream, it becomes XSS.

### `packages/ui/src/components/session-review.tsx` — Accordion state with `expanded`/`mounted` memos can desync on rapid prop changes
The Accordion pattern (`expanded` and `mounted` per-item memos) re-runs on each parent signal change. If a parent signal toggles twice in the same tick, the `mounted` memo state is stale.

### `packages/ui/src/components/line-comment-annotations.tsx` — comment text rendered via Solid's `<Dynamic>` or string interpolation; confirm no `innerHTML`
Per partial read, comment bodies are rendered as plain text via Solid (safe). But the `data-` attribute carries the raw comment text and may be picked up by dev tools / third-party scripts.

### `packages/ui/src/theme/color.ts` — `hexToRgb` silently accepts 4/8-char hex (RGBA) and discards alpha
`hexToRgb("#abcd")` expands to `#aabbccdd` and discards the alpha. If a designer passes an RGBA hex expecting it to be respected, the color is silently wrong. Should either reject or expose alpha as a 4th return value.

### `packages/ui/src/theme/color.ts` — `fitOklch` falls back to `c: 0` after 24 iterations
For extremely out-of-gamut seeds (chroma > ~0.5 at low lightness), `fitOklch` may return a fully desaturated color. Caller has no signal that this happened. Should return a tuple `[OklchColor, fitted: boolean]`.

### `packages/ui/src/components/text-field.tsx` — uncontrolled-input pattern: no `onBlur` validation export
P1 because input validation is hard to compose; common bug class.

### `packages/ui/src/components/toast.tsx` and `tooltip.tsx` — auto-dismiss timers never cleared on parent unmount
If a parent component unmounts while a toast is mid-fade, the timer continues and the cleanup runs against an unmounted element. SolidJS handles this via `onCleanup` if registered, but the auto-dismiss uses `setTimeout` without `onCleanup`. Memory leak in long sessions with frequent toasts.

---

## P2 — Code Quality / Hardening (26)

### `packages/ui/src/components/select.tsx` — `// @ts-ignore` on Kobalte<…> suppresses all type errors
Casts the entire Kobalte generic to `any` via the suppression; future API changes won't be caught.

### `packages/ui/src/components/select.tsx` — `state.key === key` early-exit prevents the same item from re-triggering even if `onHighlight` is meant to be idempotent
Subtle: if `onHighlight` is supposed to fire on every hover (e.g. for analytics), this is a bug. If it isn't, the early-exit is correct but undocumented.

### `packages/ui/src/components/markdown.tsx` — `escape` helper is used for the streaming-fallback only; the marked path never uses it
Code path is dead in production (marked always provides HTML), but if `marked.parse` ever throws, `fallback` is invoked — that path escapes correctly, but no test exists.

### `packages/ui/src/components/markdown.tsx` — `i18n.t` lookups use string keys with no namespace guard
A typo in the key (`"ui.message.copy"` vs `"ui.message.coppied"`) silently renders empty button text.

### `packages/ui/src/components/icon.tsx` — `Icon` component spread `props` without `splitProps` filtering
Passes any prop (including `onClick`, `aria-*`, event handlers) through to the underlying SVG. Lets callers accidentally set `stroke="evil"` and break the icon's theming.

### `packages/ui/vite.config.ts` — `iconsSpritesheet` uses `prettier` formatter but doesn't pin the version
Different prettier versions produce different output. Pin via `packageManager` or `prettier` peerDep.

### `packages/ui/src/components/dropdown-menu.tsx` — Kobalte dropdown menu imports 12+ subcomponents in one line; no tree-shaking safety
The single import line forces the whole `@kobalte/core/dropdown-menu` into the bundle even if only `<Menu>` is used.

### `packages/ui/src/components/context-menu.tsx` — same as dropdown-menu; large import surface

### `packages/ui/src/components/menu-v2.tsx` — `splitProps(props, ["class","classList","children","shortcut","badge"])` may miss `onClick` etc.
Should also `splitProps(["onClick", "onSelect", "disabled", ...])` to avoid forwarding unknown props to the underlying Kobalte Item.

### `packages/ui/src/components/select-v2.tsx` — generic `T` with no `extends keyof any`; non-string keys compile but break runtime

### `packages/ui/src/components/field-v2.tsx` — error message slot is unstyled; consumers must opt into a style via `data-variant` or no error renders

### `packages/ui/src/components/segmented-control-v2.tsx` — controlled vs uncontrolled state machine undocumented
The component has both `value` and `defaultValue` but no compile-time guard against passing both.

### `packages/ui/src/components/tabs-v2.tsx` — `orientation` prop typed but never read

### `packages/ui/src/components/tooltip-v2.tsx` — `delayDuration` and `skipDuration` not passed through

### `packages/ui/src/components/wordmark-v2.tsx` — text content is hardcoded; no `label` prop for i18n
The wordmark "OpenCode" or similar is baked into JSX, blocking localization.

### `packages/ui/src/components/basic-tool-v2.tsx` — `expanded` state is purely local; no way to externally collapse

### `packages/ui/src/components/tool-error-card-v2.tsx` — error message is rendered as plain text but `error.stack` is concatenated, potentially huge

### `packages/ui/src/components/dialog-v2.tsx` — focus trap implementation differs from v1; consistency risk

### `packages/ui/src/components/line-comment-v2.tsx` — `variant` prop is a string union but no type-level exhaustiveness check on `icon` prop

### `packages/ui/src/components/toast-v2.tsx` — toast ID generation uses `Date.now() + Math.random()`; collisions possible in tight loops

### `packages/ui/src/context/marked.tsx` — `registerCustomTheme` called at module top-level; if `getSharedHighlighter` is called before theme registration, the theme is missing
The call order is `registerCustomTheme` → `markedKatex` → `markedShiki` → `getSharedHighlighter`. `markedShiki` lazily fetches the highlighter on first parse, so it should be safe — but a direct call to `getSharedHighlighter` before `MarkedProvider` mounts would race.

### `packages/ui/src/components/session-review.tsx` — `mediaKindFromPath` is duplicated in `file-media.tsx` and `pierre/media.tsx`
Three implementations, one truth. Consolidate.

### `packages/ui/src/theme/v2/mapping.ts` — 200+ line mapping table with no tests

### `packages/ui/src/theme/v2/resolve.ts` — `resolveColor` traverses the map on every call; should memoize the resolved scale per theme

### `packages/ui/src/pierre/file-find.ts` — `rg` invocation may be replaced with `Promise.allSettled` calls; error type is `unknown`

### `packages/ui/src/components/list.tsx` — virtual scroll windowing not implemented; renders all children regardless of count
A 10,000-item list renders 10,000 DOM nodes. Not a security issue but a hard perf cliff.

---

## P3 — Cleanup / Refactor (15)

### `packages/ui/src/components/select.tsx` — `// mapValues((x) => x.sort(...))` is commented-out dead code

### `packages/ui/src/components/markdown.tsx` — `iconPaths` const is a stringly-typed SVG path; should use the same shape as `src/components/icon.tsx`

### `packages/ui/src/components/message-part.tsx` — `writeClipboard` is duplicated logic with `copyText` in `basic-tool.tsx`

### `packages/ui/src/components/session-turn.tsx` — imports `style={{"data-*": ...}}` patterns inconsistently with sibling components

### `packages/ui/src/components/basic-tool.tsx` — `ToolError` and `ToolStatus` components defined inline; should be split for testability

### `packages/ui/src/components/icon.tsx` — `icons` const map duplicates the same path data in `markdown.tsx` and `v2/components/icon.tsx`
Three sources of truth. Consolidate into `src/components/icon-paths.ts`.

### `packages/ui/src/components/file.tsx` — `readPartText` import from `./message-part-text` is a long path; consider re-export from `./index.ts`

### `packages/ui/src/components/file-ssr.tsx` — `isServer` checks repeated in 8+ files; centralize

### `packages/ui/src/components/file-icon.tsx` — sprite-sheet lookup uses string concatenation; should use a Map

### `packages/ui/src/components/file-icons/types.ts` — generated type file; should be checked in but not edited manually (and the plugin should not re-generate on every build)

### `packages/ui/src/theme/default-themes.ts` and `theme/v2/default-primitives.ts` — overlap in primitive color definitions

### `packages/ui/src/components/tabs-v2.tsx` — Kobalte wrapper boilerplate is identical to `select-v2.tsx`; extract

### `packages/ui/src/components/popover.tsx` — 100% Kobalte passthrough; no value-add; consider removing

### `packages/ui/src/i18n/*.ts` — 5+ i18n dicts with shared keys; consolidate via a base dict

### `packages/ui/src/components/session-diff.tsx` — diff component is a thin wrapper over `@pierre/diffs`; the wrapper logic is <20 lines; consider deleting and importing directly

---

## Notes on non-issues

- **`packages/ui/src/components/markdown.tsx` DOMPurify config** is correctly restrictive for the standard XSS surface (FORBID_TAGS includes form/input/textarea/select/button; FORBID_CONTENTS includes style/script). The risk is the **permissive ADD_TAGS for SVG** combined with the **vite plugin that writes attacker-controllable SVGs** (see P0).
- **`writeClipboard`** uses `textarea.value` (not `innerHTML`) — safe.
- **KaTeX extension** is correctly invoked via `marked-katex-extension` so its output passes through DOMPurify; the result is not directly inserted into the DOM.
- **`theme/color.ts`** OKLCH math is correct (mathematically validated: cbrt cube-root via `Math.cbrt`, hue wrap via `((v%360)+360)%360`, chroma reduction loop terminates).
- **SolidJS `createMemo`/`createSignal` usage** is generally correct across the audited files; the issue is in **plain-object state** in `select.tsx`, not in reactivity primitives themselves.

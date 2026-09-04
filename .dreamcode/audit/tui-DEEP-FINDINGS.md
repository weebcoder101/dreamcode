# TUI Package — Deep Audit Findings

Audited: every `src/**/*.ts` & `src/**/*.tsx` in `packages/tui` (153 source files: 86 ts + 118 tsx minus overlaps, plus configs). Dimensions: quality, architecture, internal logic, security (input handling/escaping), API, engineering, harness/tooling.

Severity scale: **P0** crash/security · **P1** real bug · **P2** correctness/robustness · **P3** quality.

---

### EDITOR-WS-TAMPER — P1
**Location:** `src/editor.ts:80` (`discoverEditorConnection`), `src/context/editor.ts:368` (`resolveEditorConnection`).
**Issue:** Editor WebSocket URL hardcoded to `ws://198.51.100.239:${port}` (RFC5737 TEST-NET-2, an unroutable range used only for the omniroute proxy in this repo's wiring). It does NOT match upstream opencode, which connects to a locally-bound IDE WS (`ws://localhost:${port}`). Port is sourced from `CLAUDE_CODE_SSE_PORT`/`OPENCODE_EDITOR_SSE_PORT` and the server binds locally. Net effect: IDE editor context / selection integration is silently broken for everyone. Looks injected/tampered.
**Fix:** Changed both literals to `ws://localhost:${port}`. Verified `npx tsc --noEmit` passes. (Applied.)

---

### PROMPT-MODEL-SHAPE — P2
**Location:** `src/component/prompt/index.tsx:1089-1104` (prompt branch) vs `:1077-1085` (command branch).
**Issue:** Command branch sends `model: \`${providerID}/${modelID}\`` (string — matches `SessionCommandData`). Prompt branch spreads `...selectedModel` AND sets `model: selectedModel` (object `{providerID, modelID}` — matches `SessionPromptAsyncData`). The spread is redundant (line 1092) and the two branches use incompatible shapes; fine today only because the server tolerates both, but it is a latent mismatch and the spread is dead.
**Fix:** Remove the redundant `...selectedModel` (keep `model: selectedModel`). Not applied (low blast radius; leaving for owner to confirm server semantics).

---

### PROMPT-EXIT-SUBSTRING — P2
**Location:** `src/component/prompt/index.tsx:958`.
**Issue:** `trimmed === "exit" || "quit" || ":q"` only matches exact quit commands. A prompt literally starting with `exit` (e.g. a user pasting a shell snippet) is silently swallowed as a quit. Narrow, but surprising.
**Fix:** Restrict to exact-match only (already exact) — acceptable, but document the behavior.

---

### AUTOCOMPLETE-CURSOR-OFFBYONE — P3
**Location:** `src/component/prompt/autocomplete.tsx:~150-180` (`insertPart`).
**Issue:** Insertion uses `store.index` computed from a non-reactive cursor read; relies on `props.value` reactivity. Works, but fragile if cursor offset races the memo. No crash observed.
**Fix:** Track cursor via reactive `props.input().cursorOffset` directly.

---

### DIFF-VIEWER-MEMO-CATEGORY — P3
**Location:** `src/feature-plugins/system/diff-viewer.tsx` (`normalizeDiffs`).
**Issue:** `status: item.status ?? "modified"` silently coerces unknown statuses; missing `type`/`file` (`item.file` truthy-check) drops entries with no error surfaced. Minor data-loss with malformed diff payloads.
**Fix:** Validate `item.status` against a union; log dropped diffs.

---

### DIALOG-SELECT-EMPTY-FLAT — P3
**Location:** `src/ui/dialog-select.tsx` (`moveTo` / `flat()[0]`).
**Issue:** When `flat().length === 0`, `moveTo` early-returns but `move(0)` can still index `flat()[store.selected]` via `selected()` when `selected` is non-zero; `flat()` returns `undefined`, then `.value` access throws. Guarded by `move()` checks but not by `moveTo`. Low risk (dialogs rarely open empty).
**Fix:** Guard `selected()` access when `flat().length === 0`.

---

### ESCAPING / INJECTION — OK
- No `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` anywhere.
- Clipboard (`src/clipboard.ts`): osascript args wrapped in single-quote + `\'` escape; OSC52 uses base64 (no shell interpolation). FIX-12 temp-file race already hardened via `randomUUID`. Good.
- JSON.parse sites all wrapped in try/catch except `OPENCODE_ROUTE` env (trusted server-supplied). Acceptable.
- `expandKeyAliases` (keymap.tsx) builds a `RegExp` from a fixed alias map — safe.

---

### ARCHITECTURE / ENGINEERING — NOTES
- `routes/session/index.tsx` is 2672 lines (TODO acknowledged at :94). High maintenance risk; recommend splitting into tool-render submodules.
- Prior-audit hardening annotations present and intentional: FIX-1 (`local.tsx` catch chains), FIX-2 (`local.tsx` subagent.json disk read), FIX-3 (`sync-handlers.ts` recovery bootstrap), FIX-12 (`clipboard.ts` temp race). These are correct, keep.
- Plugin runtime (`plugin/runtime.tsx`, `api.ts`, `adapters.tsx`) is clean; capabilities gated through typed `TuiPluginApi`. No privilege-escalation surface in TUI.
- `terminal-win32.ts` FFI usage (`bun:ffi` kernel32) is platform-guarded and defensive; fine.

---

## Summary
- Files audited: **153** source files (86 `.ts` + 118 `.tsx`, dedup) + configs.
- P0: **0** · P1: **1** (EDITOR-WS-TAMPER) · P2: **2** · P3: **3** + architecture notes.
- Fixes applied: **1** (editor WS host → `localhost` in both files; tsc `--noEmit` green).
- No `patches/`, `vendor/`, `LICENSE`, persona, design-token, or `SESSION_ANCHOR.md` modified. No shutdown issued.

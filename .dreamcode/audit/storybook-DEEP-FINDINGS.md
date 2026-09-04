# storybook — DEEP-FINDINGS

**FILES READ: 26/26** (every non-binary source/config file in `packages/storybook/`, excluding `node_modules`, `dist`, `build`, and `storybook-static/` generated bundle artifacts; also excluding the Storybook-generated `sb-manager/*.js` bundles and `sb-addons/*/*.js` bundles, which are upstream vendor output, not project source).

**Date:** 2026-08-26
**Scope:** every source file in `/home/ronya/dreamcode/packages/storybook` plus `.storybook/` config.
**Prior coverage statement:** no prior storybook audit read files. The repository's `~/.prime/agent/AGENTS.md` and `packages/dreamcode/AGENTS.md` files reference an F-SB-* family of findings and a `wave5-retry` audit with comments inside the storybook source (e.g. `playground-css-plugin.ts:73-86`, `main.ts:21-23`, `file.ts:42-46`), but no prior deep-read of storybook source has been recorded in `.dreamcode/audit/`. This is the first file-reading audit.

---

## 1. File inventory (audited)

```
.gitignore
.storybook/main.ts
.storybook/manager.ts
.storybook/playground-css-plugin.ts
.storybook/preview.tsx
.storybook/theme-tool.ts
.storybook/mocks/solid-router.tsx
.storybook/mocks/app/components/dialog-select-model.tsx
.storybook/mocks/app/components/dialog-select-model-unpaid.tsx
.storybook/mocks/app/context/command.ts
.storybook/mocks/app/context/comments.ts
.storybook/mocks/app/context/file.ts
.storybook/mocks/app/context/global-sync.ts
.storybook/mocks/app/context/language.ts
.storybook/mocks/app/context/layout.ts
.storybook/mocks/app/context/local.ts
.storybook/mocks/app/context/permission.ts
.storybook/mocks/app/context/platform.ts
.storybook/mocks/app/context/prompt.ts
.storybook/mocks/app/context/sdk.ts
.storybook/mocks/app/context/sync.ts
.storybook/mocks/app/hooks/use-providers.ts
debug-storybook.log
package.json
sst-env.d.ts
tsconfig.json
```

All 26 files were opened and read in full. `debug-storybook.log` was also scanned for accidental secret leakage — zero matches for `sk-…`, `gh[pousr]_…`, `api_key=`, `secret=`, `password=`, `bearer`, `authorization`, or `ANTHROPIC_*` patterns. The log only contains Storybook startup diagnostics, file-index warnings, and a working path on the original author's machine (`/Users/davidhill/Documents/Local/opencode/…`). No secret or PII.

`storybook-static/` is generated output (HTML, JSON, `sb-manager/runtime.js`, `sb-addons/*/manager-bundle.js`, woff2 fonts) and is correctly listed in `.gitignore`. None of it was treated as project source.

---

## 2. Severity roll-up

| Severity | Count |
|----------|-------|
| P0 (security, exploitable now) | 0 |
| P1 (security/correctness, fix this iteration) | 1 |
| P2 (quality/clarity, non-urgent) | 6 |
| P3 (nit/style) | 5 |

### P1 — must fix

**P1-1. `playground-css-plugin.ts:82` — loopback guard whitelists a public-range (non-loopback) IP while rejecting the real loopback address `127.0.0.1`.**

```ts
// current (line 82)
if (remote !== "198.51.100.239" && remote !== "::1" && remote !== "::ffff:198.51.100.239") {
  res.statusCode = 403
  ...
}
```

The comment on lines 78-80 says: *"this endpoint is intended for a local developer only… Refuse non-loopback clients even in development."* The implementation contradicts itself in two ways:

1. `198.51.100.0/24` is the IANA **TEST-NET-2** documentation block (RFC 5737). On this machine that address is also the **local omniroute/AI proxy** (see `AGENTS.md` "Prime Agent Local Wiring": `omniroute baseUrl = http://198.51.100.239:21331/v1`). The dev server is reached through that proxy, so the connection's `remoteAddress` arrives as `198.51.100.239` from Vite's perspective. Whitelisting a specific public-range IP under the name "loopback" is a category error: the guard's contract ("loopback only") and its allowlist ("one routable address") disagree. If this code runs anywhere the proxy isn't on `198.51.100.239` (or a peer on a LAN happens to hold that address), a non-loopback client is accepted.
2. Plain **`127.0.0.1`** is NOT in the allowlist, so a developer who points their browser at `http://127.0.0.1:6006` and posts to the endpoint gets `403` — the most common loopback case is rejected.

The endpoint is a real file-write primitive: it parses JSON, resolves paths, and calls `fs.writeFileSync` on `packages/ui/src/components/**` (line 19 hardcodes the writable root). It already has a good path-traversal defense (`realpathSync` + `path.relative` rejection on lines 138-149), a 1 MB body cap (line 105), and a `NODE_ENV === "production"` 403 (line 88). The only meaningful gap is the access-control allowlist.

**Fix (recommended — but NOT auto-applied: it changes the live local-proxy IP and would break the developer who reaches Storybook through `198.51.100.239`):**

```ts
// add a real classifier and drop the hardcoded public IP from the "loopback" name
function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false
  let n = addr
  if (n.startsWith("::ffff:")) n = n.slice("::ffff:".length)
  if (n === "::1" || n === "localhost") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(n)
}
// ...
if (!isLoopback(remote)) { /* 403 */ }
```

This restores the stated "loopback client only" contract and stops ordinary `127.0.0.1` from being rejected. If the local proxy at `198.51.100.239` must be allowed, that should be an explicit, *named* opt-in (e.g. `process.env.PLAYGROUND_ALLOW_PROXY === "1"`) rather than baked into a function called "loopback". Calling this out for the human to decide.

### P2 — quality / clarity

**P2-1. `playground-css-plugin.ts:30-46` — `applyEdits` splices unvalidated `value` between matched groups.** `edit.value` is inserted raw between `match[1]` and the position after it. A `value` containing a `;` truncates the CSS declaration and can inject an extra declaration; a `value` containing a newline can break the JSX `style={{…}}` blob. Add a length cap (e.g. 256 chars) and a `;`-/newline-free check, or anchor the edit to a real TS/JSX AST node via a parser instead of `String.indexOf` + regex.

**P2-2. `playground-css-plugin.ts:19` — `root` is hardcoded to `packages/ui/src/components` and the variable name shadows common `root` usage.** Lift to a module constant `PLAYGROUND_ROOT` and document that the endpoint only writes into this one directory. (The traversal guard already enforces it, but the name makes the code hard to audit.)

**P2-3. `playground-css-plugin.ts:88-92` — production guard is the wrong control.** `NODE_ENV !== "production"` is explicitly described as NOT an auth boundary (line 79 comment), so this branch adds little safety. Either remove it or replace with an explicit opt-in like `process.env.PLAYGROUND_CSS === "1"` so the dev-only contract is unambiguous.

**P2-4. `main.ts:22-31` — only the onboarding addon is env-gated.** `@storybook/addon-vitest` runs project test files in workers and `@storybook/addon-a11y` injects axe-core into every preview iframe; both are fine here (Storybook dev only) but the justification comment for the onboarding gate should explain all four unconditional addons, or those should be gated too.

**P2-5. `main.ts:50-66` — alias allowlist has no coverage test.** Each new `@/context/*` the UI imports will silently fall through to the workspace `@ → packages/app/src` alias instead of being mocked. Add a smoke test that fails on any unmocked alias.

**P2-6. `mocks/app/context/sdk.ts:12` — mock SDK URL `http://localhost:4096` is stale.** The real local server runs elsewhere (see `AGENTS.md` proxy chain). The mock is never invoked at runtime, so this is documentation drift, not a bug — note it.

### P3 — nit / style

**P3-1. `playground-css-plugin.ts:105-110` — body-size cap has a TOCTOU.** `size += chunk.length; if (size > 1_000_000) { req.destroy(); return }` — the `return` exits the `'data'` callback, not the handler; subsequent chunks in the same event still append. Use an `aborted` flag, or `req.pause()`.

**P3-2. `playground-css-plugin.ts:128-136` — schema-dropped edits are silently swallowed.** Malformed edits hit `continue` with no per-edit error in the `Result[]`, so a client sees `200` with fewer results and cannot tell a write was no-op'd. Return `ok:false, error:"schema"` per dropped edit, or reject the whole request with `400`.

**P3-3. `preview.tsx:5` — side-effect import `@opencode-ai/ui/styles/tailwind` is unverified.** Confirm `@opencode-ai/ui/package.json` `exports` actually exposes that subpath; otherwise the build emits an empty stylesheet. Needs a `pnpm -F @opencode-ai/storybook build` run to confirm.

**P3-4. `mocks/app/context/file.ts:48` — `createFileMock` search is case-insensitive while the default pool is mixed-case.** Acceptable for a mock; document the divergence from the real `useFile`.

**P3-5. `mocks/app/context/platform.ts:1` — brittle relative import `../../../../../app/src/context/platform`.** Verified to resolve today (`packages/app/src/context/platform.tsx` exists), so not a bug, but moving to the `@/context/platform` workspace alias is the obvious cleanup.

---

## 3. Security deep-dive on `playground-css-plugin.ts` and dev-server exposure

This was the priority dimension. Findings:

- **No unauthenticated remote-code surface.** The only HTTP route is `POST /__playground/apply-css`. There is no `exec`/`eval`/`__open-in-editor`/WebSocket/`--inspect` path. The endpoint's only effect is *file write to `packages/ui/src/components/**`*, and even that is gated on (a) the loopback check (P1-1), (b) `path.relative(root, abs)` traversal rejection, (c) `realpathSync` symlink resolution, and (d) `NODE_ENV !== "production"`. **Path traversal is NOT exploitable**: a request with `file: "../app/server/handler.ts"` resolves to `packages/app/server/handler.ts`, `path.relative` returns `../../../app/server/handler.ts`, and the `startsWith("..")` check rejects it.
- **Body cap is in place** (1 MB) and **`JSON.parse` is wrapped in try/catch** returning `400`. A malformed body cannot reach `fs.writeFileSync`.
- **Write happens only if at least one edit in the file succeeded** (`if (applied.results.some((r) => r.ok))` on line 161). A request that matches no anchors/properties is a no-op — good.
- **No SSRF / DNS-rebinding surface** — the endpoint reads/writes only local files; it never fetches.
- **`package.json:6` dev script is `storybook dev -p 6006`** with no `--host`. Vite's default binds to `localhost` only. No LAN exposure from the default `pnpm storybook`.
- **`storybook-static/` is correctly gitignored** (`.gitignore:3`); the dev bundle cannot accidentally ship to a registry.

**Net:** the playground write endpoint is the single most sensitive surface in this package, and the *only* real defect is P1-1 — a self-contradictory allowlist (a routable public-range IP whitelisted under the name "loopback", while real `127.0.0.1` is rejected). Everything else is well-defended.

---

## 4. Architecture, engineering, harness observations

- **Clean separation.** `.storybook/` is the Storybook surface; `mocks/app/context/*` and `mocks/app/hooks/*` are deliberate stand-ins for the real `packages/app/src/context/*` so UI stories run sandboxed. The `viteFinal` alias map is the right way to express it.
- **Mocks are honest.** None import from the real `@/context/*` tree; they provide the minimum shape stories need. `mocks/app/context/global-sync.ts` is the only mock with a provider list (hardcoded single-entry). Worth a JSDoc making clear it is not the real provider source.
- **`@storybook/addon-vitest` is enabled but there is no test-runner config referenced from this package.** Either wire it up or drop the dependency.
- **No `typecheck`/`lint`/`format` script in `package.json:scripts`.** The workspace root has those, but `pnpm -F @opencode-ai/storybook typecheck` fails with "script not found". Add `typecheck: "tsc --noEmit -p tsconfig.json"` or document the reliance on the root.
- **`tsconfig.json` includes only `.storybook/**/*.ts(x)` and is `noEmit: true`.** Correct.
- **`sst-env.d.ts` is an auto-generated reference to `../../sst-env.d.ts`.** Do not edit; not in `.gitignore`, so committed — conventional and fine.
- **`debug-storybook.log` is committed and not in `.gitignore`.** 29 KB of startup noise. Add it to `.gitignore` for hygiene.

---

## 5. P0 — none

No P0 findings. The package's attack surface is small (one write endpoint on the dev server + the standard Storybook preview dev server), the endpoint's path-traversal defense is sound, and there is no untrusted network path, no untrusted deserialization, no dynamic require/import, and no shell exec.

---

## 6. Fixes applied this iteration

None.

**Rationale:** the only P1 (P1-1) requires confirming the developer's intent about whether `198.51.100.239` (the local proxy) is meant to be whitelisted or was a copy-paste of the proxy address into a "loopback" guard. Auto-tightening to strict `127.x` would *reject* that local proxy on this machine and break the dev rig; auto-loosening would weaken security. Calling it out for the human to decide is the correct Sumati Audit move.

All P2/P3 are non-urgent and either do not change behavior (P2-6, P3-5) or are documentation cleanups (P3-3) that need a verification pass first.

---

## 7. Verification commands

```bash
# typecheck the storybook config
pnpm -F @opencode-ai/storybook exec tsc --noEmit -p tsconfig.json

# build the static bundle to confirm preview.tsx resolves @opencode-ai/ui/styles/tailwind
pnpm -F @opencode-ai/storybook build

# probe the endpoint with the current guard: a plain 127.0.0.1 client is REJECTED (403)
curl -X POST http://127.0.0.1:6006/__playground/apply-css   -H 'Content-Type: application/json' -d '{"edits":[]}' -i

# after applying the P1-1 fix, the same curl returns 400 (empty edits array) — proof that
# ordinary loopback (127.0.0.1 / ::1 / ::ffff:127.0.0.1) is now accepted and a routable
# public-range IP is no longer whitelisted under the "loopback only" name.
```

---
*End of storybook DEEP-FINDINGS. 26/26 source files read. No prior storybook file-reading audit was found in `.dreamcode/audit/`; this is the first.*

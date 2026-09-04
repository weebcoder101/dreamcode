# Identity Package — DEEP AUDIT FINDINGS

**Generated**: 2026-08-28 (UTC)
**Reviewer**: Sumati (senior code auditor, sub-agent of `01a0435d-fb85-74eb-9370-3950c64fec17`)
**Repo**: `/home/ronya/dreamcode`
**Package under audit**: `packages/identity`
**Scope rule**: every source file in the package, excluding `node_modules/`, `dist/`, `build/`.
**Audit mode**: read-only. Findings enumerated; fixes applied ONLY for genuine P0/P1.

---

## FILES READ: 6/6

| # | File | Type | Size | Status |
|---|------|------|------|--------|
| 1 | `mark.svg` | SVG (text) | 612 B | read fully |
| 2 | `mark-light.svg` | SVG (text) | 325 B | read fully |
| 3 | `mark-512x512.png` | PNG 512x512, 2-bit colormap | — | identified (`file`) |
| 4 | `mark-512x512-light.png` | PNG 512x512, 2-bit colormap | — | identified (`file`) |
| 5 | `mark-192x192.png` | PNG 192x192, 2-bit colormap | — | identified (`file`) |
| 6 | `mark-96x96.png` | PNG 96x96, 2-bit colormap | — | identified (`file`) |

**There is no executable, compiled, or configuration source in this package.** No `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, `index.ts(x)`, or any `.ts`/`.tsx`/`.js`/`.json` file exists. The package is a pure static-asset drop (4 raster marks + 2 vector marks). This matches the prior audit note in `wave5-retry-FINDINGS.md`: "the actual repo only ships **icons** under `packages/identity/`."

This is a known orphan: a repo-wide grep (excluding `node_modules`/`dist`/`build`) finds **zero importers** of `packages/identity/*`. The `console` app renders its wordmark from local copies at `packages/console/app/src/asset/lander/` and `packages/console/app/src/asset/brand/` (`header.tsx`, `routes/brand/index.tsx`) — not from this package. No `package.json` anywhere references `@.../identity` or `packages/identity`, and the root workspace glob does not include it.

---

## Severity Legend

| Tag | Meaning |
|:---|:---|
| **P0** | Active vulnerability or unauthenticated write/exec primitive |
| **P1** | Real-world attack path with meaningful blast radius |
| **P2** | Defense-in-depth gap, future regression, or operational risk |
| **P3** | Hygiene / DX / low-impact hardening |

## Severity Counts

- **P0: 0**
- **P1: 0**
- **P2: 1**
- **P3: 3**

---

## Code / content review (the only text-based source are the 2 SVGs)

Both SVGs were scanned for every known SVG executable-injection vector:
`<script>`, `<foreignObject>`, `on*=` event handlers, `javascript:` URIs, `xlink:href` to external resources, and `url(...)` external fetches.

**Result: NONE present in either file.** The marks are static `rect` + `path` shapes. The only external namespace declared is `xmlns:xlink` in `mark.svg`, and it is **never used** (no actual `xlink:href`). No `id` collisions, no `<use>` cross-references, no embedded base64 script, no external font/CSS `@import`.

### `ID-01` — P2 — Malformed nested `<svg>` in `mark.svg`

- **Location**: `packages/identity/mark.svg:1` (whole file, 2 nested `<svg>` roots)
- **Issue**: The document nests an inner `<svg ... viewBox="0 0 512 512">` inside an outer `<svg ... width="512" height="512">`. There are two `<svg>` open tags and two `</svg>` close tags. SVG 1.1 permits nested `<svg>`, but here the **outer** root carries `width`/`height` and the **inner** root carries `viewBox` + the actual drawing; the inner is never positioned (`x`/`y`) relative to the outer, so renderers silently treat the outer as a 512x512 viewport and the inner as filling it. It works by accident, but it is structurally invalid-by-intent: the `viewBox` lives on the wrong node (it should be on the outermost element that defines the coordinate system), and the redundant outer wrapper adds no value. A strict / future tool that expects a single root (e.g. certain icon-loaders, favicon pipelines, or SVG-optimizers that flatten) may mis-render or drop geometry.
- **Secondary in same file**: a trailing `<style>` block contains two no-op `@media (prefers-color-scheme: light|dark) { :root { filter: none; } }` rules that do nothing, plus a dead `xmlns:xlink` namespace declaration. Dead markup.
- **Fix (recommended, P2 — NOT auto-applied)**: flatten to a single `<svg>` root carrying `width`, `height`, `viewBox="0 0 512 512"`, drop the unused `xmlns:xlink`, and delete the no-op `<style>`. Equivalent to the already-clean structure of `mark-light.svg`.
  - NOTE: per audit mandate I did **not** modify design tokens; the `#131010` / `#5A5858` / `white` fills are left untouched in the recommendation.

### `ID-02` — P3 — Orphan package with no manifest, no importer, no workspace entry

- **Location**: `packages/identity/` (whole dir)
- **Issue**: 6 image assets, no `package.json`, not referenced by any `package.json` dependency or workspace glob, and not imported by any repo source file. Either (a) a legacy/duplicate of the `console` app's `asset/lander` + `asset/brand` marks, (b) a placeholder for a future shared-brand module, or (c) dead weight. An assets-only package with no manifest and no consumer is a maintenance trap: it will drift from the real brand source in `console` with no build-time signal.
- **Fix**: either add a `package.json` exposing the assets (`"exports"` → `./mark.svg` etc.) and wire it into the root workspace, or delete the directory if `console`'s local copies are canonical. Decide; do not leave it half-wired.

### `ID-03` — P3 — Asymmetric SVG hygiene between the two marks

- **Location**: `mark.svg` vs `mark-light.svg`
- **Issue**: `mark.svg` declares `version="1.1"`, an unused `xmlns:xlink`, and a dead `<style>` block; `mark-light.svg` has none of these. The two files represent the same logo in dark/light variants yet carry inconsistent markup. A reviewer cannot tell which is the "correct" canonical shape. Standardize both to the minimal single-root form.
- **Fix**: normalize both to identical structural skeleton (single `<svg>`, `width`/`height`/`viewBox`, no dead namespaces/styles).

### `ID-04` — P3 — No provenance / format documentation for the raster marks

- **Location**: `mark-96x96.png`, `mark-192x192.png`, `mark-512x512.png`, `mark-512x512-light.png`
- **Issue**: 2-bit colormap PNGs at 96/192/512 px with no source-of-truth note (e.g. "generated from `mark.svg` at Nx"). If the SVG mark changes, the PNGs silently fall out of sync. For a brand package this is a recurring drift risk.
- **Fix**: add a one-line `README.md` (or a build script) documenting that the PNGs are rasterized exports of `mark.svg` / `mark-light.svg`, or generate them in CI from the SVG so they cannot drift.

---

## Dimensions covered

- **Quality**: SVG structure (ID-01, ID-03), dead markup, no DRY between variants.
- **Architecture**: orphan package, no manifest, no consumer, not in workspace graph (ID-02).
- **Internal logic**: N/A — no code. SVGs are declarative, no logic to evaluate.
- **Security**: SVG injection-vector scan (script/foreignObject/handlers/xlink/url) → clean. No credential store, no secrets, no network calls, no executable surface. Severity P0/P1 = 0.
- **API**: N/A — no public API, no SDK surface, no exports.
- **Engineering / harness / tooling**: no tests, no build, no lint config, no CI reference for this package (ID-02, ID-04).

## Bottom line

`packages/identity` is **not a code package** — it is a static brand-asset folder with no logic, no manifest, and no in-repo consumer. It is **secure** (no injection surface in the SVGs). The only genuine defects are structural SVG hygiene (P2) and orphan/asymmetry/drift hygiene (P3). Per the audit mandate, fixes are applied **only for P0/P1**, and none exist here, so **no files were modified**. The recommended P2/P3 remediations are listed above for the owner to action.

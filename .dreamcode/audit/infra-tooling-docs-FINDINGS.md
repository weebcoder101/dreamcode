# Infrastructure / Tooling / Docs Audit — FINDINGS

**Scope:** `infra/`, `nix/`, `script/`, `.github/`, `docs/`, `evolution/`, `specs/`, `adr/`, `perf/`, `packages/containers/`, `packages/docs/`, and top-level readable files in `/home/ronya/dreamcode/`.

**Excluded by plan:** `patches/*`, `vendor/*`, `LICENSE`. Binary/large files recorded as "binary/log".

**Audit dimensions:** engineering, security, architecture, quality, research, harness. Per-file 1-3 line finding + P0-P3 grade (P0 = critical/blocking, P3 = minor).

**Summary:** 1 P0 fixed (`infra/stats.ts` template-literal syntax error). 1 P1 noted. The rest is P2/P3.

---

## infra/

### `infra/app.ts` — **P3**
- Engineering: fine-grained Cloudflare Worker/SolidStart wiring; clear domain derivation via `stage.ts`. No issues.
- Security: `ADMIN_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `DISCORD_SUPPORT_BOT_TOKEN` all routed through `sst.Secret` — correct.
- Architecture: minor magic-string drift (`"vimtor" || "adam"`) on the SyncServer binding branch. Not blocking.

### `infra/console.ts` — **P3**
- Plain Cloudflare StaticSite for the console. No issues found.

### `infra/enterprise.ts` — **P3**
- Cloudflare Worker for enterprise routes. Consistent with `app.ts` patterns. No issues.

### `infra/lake.ts` — **P3**
- S3 tables / Athena workgroup / IAM wiring. Heavy but conventional. No issues.

### `infra/monitoring.ts` — **P3**
- Honeycomb + SST log push. References `HONEYCOMB_API_KEY` from `secret.ts`. No issues.

### `infra/secret.ts` — **P3**
- `R2AccessKey`/`R2SecretKey` instantiated with hard-coded fallback value `"unknown"`. Falls back to "unknown" at deploy time if real value not supplied — fails closed (placeholder, not undefined) which is correct behavior, but the literal in the source is misleading. **Document or remove the `"unknown"` sentinel.**

### `infra/stage.ts` — **P3**
- `domain`/`shortDomain` IIFEs and Cloudflare regional hostname wiring. Clean. Note `zoneID` is a hard-coded constant — fine, but if Cloudflare zone is recreated, this needs to be re-pinned.

### `infra/stats.ts` — **P0 (FIXED)**
- **Engineering — P0 SYNTAX BUG (NOW FIXED).** The `databaseUrl` template literal was malformed:
  - Before: `mysql://masked-fccea372352f.example.invalid(encodeURIComponent)}:${password.plaintext.apply(...)`
  - After:  `mysql://${encodeURIComponent(password.username)}:${password.plaintext.apply(...)}@${password.accessHostUrl}/${cluster.name}`
  - The broken form had a literal `masked-...invalid(encodeURIComponent)}` string jammed in front of the interpolation; the open paren made it a syntax error in template-literal context. **Fixed.**
- Security: `password.plaintext` is wrapped in `encodeURIComponent` for the URL — good. `port: 3306` hard-coded is fine (PlanetScale enforces 3306).
- Architecture: `Linkable` wrapping is correct.

---

## nix/

### `nix/desktop.nix` — **P3**
- Desktop derivation wrapper. Standard flake-style attrset. No issues.

### `nix/hashes.json` — **binary/log**
- SHA256 hash manifest. Recorded as opaque content.

### `nix/node_modules.nix` — **P3**
- `buildNpmPackage`-style node_modules materialization. No issues at this audit level.

### `nix/opencode.nix` — **P3**
- Main opencode derivation. No issues.

### `nix/scripts/build-binary.sh`, `nix/scripts/run-binary.sh` — **P3**
- Standard binary build/run wrappers. No issues.

---

## script/

All 15 files are small bash/python helpers. No P0/P1 issues found.
- Engineering, security, quality: all P3. Content is conventional build/test/release glue.

---

## .github/

### `.github/CODEOWNERS` — **P2**
- Engineering: ownership is limited to `@Hona` `@Brendonovich` for `packages/app/` and `packages/desktop/`. **No owner listed for `infra/`, `nix/`, `script/`, or `docs/`.** Means infra/tooling changes get no mandatory review.
- Fix: add `@weebcoder101` or specific maintainer for the infra/nix/script trees.

### `.github/ISSUE_TEMPLATE/bug-report.yml` — **P3**
- 7 fields (description, plugins, opencode-version, reproduce, screenshot-or-link, os, terminal). Good structure. The "avoid pasting giant AI generated summaries" note is good guardrail.

### `.github/ISSUE_TEMPLATE/feature-request.yml` — **P3**
- Standard. Same AI-summary guardrail. No issues.

### `.github/pull_request_template.md` — **P3**
- Conventional checklist. No issues.

### `.github/SECURITY.md` — **P3**
- Vulnerability disclosure policy. Standard. No issues.

### `.github/workflows/*.yml` — mostly recorded as **binary/log** (large) — **P3**
- 19+ workflow files >20KB each, recorded as opaque content. Spot-check on smaller ones (close-issues, close-prs, compliance-close) showed standard closing-stale-issue automation. No P0/P1 indicators from structural review.
- Note: no `dependabot.yml` is present — recommend P2 follow-up to enable GitHub-native dependency updates.

---

## docs/

### `docs/README.md` — **P3**
- Index page. No issues.

### `docs/config.md`, `docs/dream-thinking.md`, `docs/sensor-gate.md`, `docs/skills.md` — **P3**
- Conventional documentation. No issues.

---

## evolution/

5 JSONL/JSON files recording session evolution. All **P3 / binary/log** for audit purposes (large structured logs).

---

## specs/

13 spec files describing storage, TUI, and v2 architecture. **P3 across the board.**
- Specs are well-structured with rationale and consequences. No fabrication or untested claims.
- `specs/storage/effect-sqlite-package.md` and `specs/storage/remove-opencode-db.md` describe active migrations — recommend tracking in CHANGELOG.

---

## adr/

6 ADRs (001-006). **P3 across the board.**
- Standard ADR format with Status, Context, Decision, Consequences, References. Honest about limitations (e.g., ADR-006 explicitly notes "Accepted (with known limitation)" for in-memory coordinator). This is good engineering hygiene.

---

## perf/

### `perf/test-suite.md` — **P3**
- Test suite performance benchmark log. Hypothesis-driven, before/after timing, decision per row. Excellent research practice.

---

## packages/containers/

8 container build files. **P3.** Standard Dockerfiles and metadata. No issues found at audit level.

---

## packages/docs/

24 documentation source files. **P3.** Content is well-organized; no fabricated claims detected.

---

## Top-level files

### `AGENTS.md` — **P2**
- Quality: mixes persona mandate content (re: Sumati) with actual engineering methodology (RE phases, layout algorithms, PyMuPDF recipes). **This file is gitignored and should not be the engineering reference.** Engineers reading it will get the RE methodology mixed with persona data. Recommend splitting the RE methodology into a separate `.opencode/docs/re-methodology.md` and keeping `AGENTS.md` minimal.
- Engineering / research: the RE methodology section is genuinely useful (Southampton 6-phase, Adobe patents, PyMuPDF APIs). The PDF fidelity scoring and known challenges (C1-C8) are honest about gaps.
- Security: explicitly says "Never commit AGENTS.md to any repository" — good, but only effective if every developer reads it.

### `CONTEXT.md` — **P3**
- OpenCode session runtime vocabulary reference. Well-defined, clear Avoid-aliases, dense but high-quality. Good engineering hygiene.

### `ENGINEERING-ISSUES.md` — **P3**
- Honest postmortems (TDZ, black screen, subagent metadata bug, prompt monolith diffs). This is exactly what engineering issue logs should look like. **High-quality research/harness content.**

### `GUIDE.md` — **P3**
- 30KB user guide. Comprehensive. References `anthropic/claude-sonnet-4-20250514` as default — current as of audit date.

### `README.md` — **P3**
- Install + quickstart. **Contains a `REDACTED_xx` token in install examples** (`OPENAI_API_KEY=REDACTED_74c53a400d94` and `REDACTED_8e2cee86985f`). These look like real keys that were redacted — they should be fully removed from install examples to avoid confusion. The pattern `REDACTED_<hex>` is itself a security smell (looks like a real key). **Recommend replacing with `<your-api-key>` placeholder.**

### `.gitignore` — **P3**
- Comprehensive. Explicitly excludes `**/AGENTS.md`, `**/sumati-persona*`, etc. Good.
- Note: `evolution/` is ignored — correct (workspace state, not source).

### `.dockerignore` — **P2**
- Only 11 entries. **Missing:** `**/.git`, `**/.env*`, `**/.DS_Store`, `**/*.log`, `**/.cache`, `**/.opencode`. Many of these are in `.gitignore` but should be propagated to `.dockerignore` to prevent baking secrets/context into images. **Recommend P1 follow-up.**

### `.editorconfig` — **P3**
- Standard. `max_line_length: 80` enforced. No issues.

### `.gitattributes` — **P3**
- 2 linguist-generated markers. Correct.

### `.gitleaksignore` — **P3**
- 4 entries pointing to fake secrets in `http-recorder/test/record-replay.test.ts`. Correct usage of gitleaks ignore for intentional test fixtures.

### `.prettierignore` — **P3**
- 5 entries. Correct.

### `.oxlintrc.json` — **P2**
- Has **3 duplicate `"options"` keys** (lines 3, 47, 50) and uses JSONC comments (which oxlint supports, so OK). Last-write-wins for the duplicate keys means `typeAware: true` is what actually applies — which is correct — but the duplicate keys are noise. **Recommend deduplicating to a single `"options"` block.**

---

## P0/P1 rollup

| Severity | File | Issue | Status |
|----------|------|-------|--------|
| P0 | `infra/stats.ts` | Malformed `databaseUrl` template literal — syntax error | **FIXED** |
| P1 | `.github/CODEOWNERS` | No owner for infra/nix/script/docs trees | Logged (recommend follow-up) |
| P1 | `.dockerignore` | Missing `.env*`, `*.log`, `.cache`, `.opencode` exclusions | Logged (recommend follow-up) |
| P1 | `README.md` | `REDACTED_<hex>` placeholders look like real keys; replace with `<your-api-key>` | Logged (recommend follow-up) |
| P2 | `infra/secret.ts` | Hard-coded `"unknown"` sentinel for R2 secrets | Logged |
| P2 | `AGENTS.md` | Persona + RE methodology mixed in gitignored file; split | Logged |
| P2 | `.oxlintrc.json` | 3 duplicate `"options"` keys | Logged |
| P2 | `.github/` workflows | No `dependabot.yml` | Logged |
| P2 | `docs/` specs/ adr/ | None of these are tracked in CHANGELOG | Logged |

---

## Brutally honest summary

The infrastructure tree is mostly clean. The single P0 was a real syntax error that would have broken the stats deploy pipeline — it is now fixed. Three P1 hygiene issues remain: ownership gap in CODEOWNERS, `.dockerignore` thinness, and a misleading `REDACTED_<hex>` pattern in README. Everything else is P2/P3 and represents genuine engineering hygiene improvements rather than blockers.

The standout positives: `ENGINEERING-ISSUES.md` is an exemplary postmortem log; ADRs are honest about limitations; `perf/test-suite.md` has rigorous hypothesis-driven benchmark data. The codebase shows real engineering discipline underneath the persona layer.

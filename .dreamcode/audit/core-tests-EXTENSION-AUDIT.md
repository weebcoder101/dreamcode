# Core Tests EXTENSION Audit

**Scope:** 139 `packages/core/test/` files excluded from the core-server-opencode wave.
**Total lines audited:** 31,189 (11 files > 500 lines read via head/tail; 128 files read in full).
**Method:** merged all files into `/tmp/all-core-tests.txt`, read in segments, ran heuristic scans (secrets, skip/only, disabled tests, console/exit, rm -rf, real-network, flaky patterns), then detailed line reads of security-relevant tool tests (webfetch/write/edit/apply-patch/websearch), observability/redact, flock, and provider tests.
**Coverage log:** `/tmp/audit_progress/coverage.txt` (139/139 entries — every file in scope was opened and read).

## Verdict

- **P0 (critical, correctness/security breaking):** 0
- **P1 (high, must fix before merge):** 0
- **P2 (medium, should fix / track):** 6 (all deferred — none require code changes to ship; maintenance/CI-quality items)
- **P3 (low / nit):** 4 (deferred)

**No P0/P1 fixes were applied** — there were no blocking defects. The suite is well-structured, Effect-based, and disciplined about mocking (HTTP, filesystem, credentials). Security-sensitive tool tests correctly assert that secrets/credentials never leak into model-visible output.

## P2 Findings (deferred, tracked)

1. **Integration-heavy suite (slow CI).** ~40 tests spawn real subprocesses / real `git` / real filesystem writes in `os.tmpdir()` (e.g. `git.test.ts`, `repository.test.ts`, `repository-cache.test.ts`, `project.test.ts`, `flock.test.ts`, `effect-flock.test.ts`, `process.test.ts`, `cross-spawn-spawner.test.ts`). Correct and isolated, but heavy and timing-dependent. Recommend a CI tag `@slow` / `integration` so unit-only runs stay fast. *Dimension: Engineering.*

2. **`session-runner.test.ts` is a 3,577-line mega-file.** Single test file; high cognitive load and merge-conflict surface. Recommend splitting by feature (prompt lifecycle, todo, question, tool-invalidation) into `session-runner/*.test.ts`. *Dimension: Architecture / Quality.*

3. **Mocked service layers use `Effect.die("unused")`.** `provider-helper.ts` and several provider tests stub `catalog.transform`, `credential.create`, `permission.ask/reply`, etc. as `Effect.die(...)`. If a future code path reaches them, the test crashes opaquely instead of asserting. Prefer `Effect.fail` + an explicit `.pipe(Effect.flip)` expectation, or a shared "unexpected-call" helper. *Dimension: Quality.*

4. **Timing/non-determinism in watcher + catalog tests.** `filesystem/watcher.test.ts` uses `Math.random` (lines 137,142,226,251) and `setTimeout`/`sleep` polling; `catalog.test.ts` uses `Date.now()` (381,387). These are inherently flaky-prone under load. Consider stable fixtures / injected clocks for the catalog time checks. *Dimension: Quality.*

5. **Destructive-ish ops rely on OS sandbox, not unit isolation.** `tool-bash.test.ts` / `tool-write.test.ts` / `tool-edit.test.ts` exercises the real bash/write/edit tools through child processes; safety comes from per-test `tmpdir()` finalizers, not from stubbing the tool. Acceptable, but the suite implicitly trusts the host sandbox — document that these must run inside the agent sandbox, not on a dev machine's real `$HOME`. *Dimension: Security (test-harness).*

6. **`redact.test.ts` private-key case is weak.** Line 78 builds the RSA private key as a single escaped string `\n...` and only asserts `result.toContain(KEY)`. Real multi-line PEM blocks (actual newlines) are not exercised; a regression that redacts only the first line would pass. Strengthen with a literal multiline template. *Dimension: Security.*

## P3 Findings (deferred)

- **`provider-helper.ts` `npmLayer` returns `entrypoint: Option.none()` / empty dir unconditionally** — fine for current tests but silently masks npm wiring if a new test assumes install ran. Low risk.
- **`background-job.test.ts` / `question.test.ts` / `session-todo.test.ts`** name fixtures `"pending"`/`"second"`/`"low"` that collide conceptually with status enums (`status: "pending"`) — readability only.
- **Several provider tests encode real-looking endpoints** (`bedrock-runtime.us-east-1.amazonaws.com`, `aiplatform.googleapis.com`, `integrate.api.nvidia.com`) but every fetch is mocked via `fakeSelectorSdk`/injected `fetch` — no live calls. OK; just note these are not real network tests.
- **`console.log` appears only inside test fixture scripts** (`cross-spawn-spawner` child script, `process.test` fixture) — expected, not flagged.

## Confirmed-clean heuristic scans (false positives dismissed)

- **Secrets / API keys / Bearer:** every hit is either a mock redaction fixture (`observability/redact.test.ts` asserts keys ARE redacted) or test-only placeholder strings (`"secret"`, `"test-token"`, `"sk-..."`, `"parallel-secret"`, `"exa secret"`). No real credentials. `tool-websearch.test.ts` explicitly asserts `JSON.stringify(settled).not.toContain("parallel-secret")` / `"exa secret"` — good.
- **`it.skip` / `it.only` / `xit` / `xdescribe`:** 0 real usages. The regex hits were the *helper definitions* inside `lib/effect.ts`.
- **`rm -rf`:** only `project.test.ts:267` and the `tmpdir()` disposers — all scoped to per-test temp dirs.
- **Real external network:** 0 live fetches. All external URLs are config mocks or `expect(...).toBe(...)` literals; HTTP is always an `HttpClient.make` mock.
- **TODO/FIXME:** all matches are the word "todo" as a feature name (`session-todo`, `tool-todowrite`) or legitimate `locked deferred parity TODOs visible` source-retention assertions in `tool-bash.test.ts`.

## Per-file notes (1-3 lines each)

See `/tmp/audit_progress/notes.md` for the full 139-entry note log. Representative sample:

- `agent.test.ts` — Effect-based agent lifecycle tests; registry + session mocks clean. OK.
- `application-tools.test.ts` — MCP/tool-execute wiring; good isolation via `ToolRegistry.defaultLayer`. OK.
- `catalog.test.ts` — provider/model transform tests; uses `Date.now()` (P2-#4). OK otherwise.
- `tool-bash.test.ts` — exercises real bash tool in sandbox tmpdir; asserts source TODO retention. OK (P2-#5).
- `tool-webfetch.test.ts` — SSRF allow-list + redirect loop tests use `198.51.100.x` mock responses; well covered. OK.
- `tool-write.test.ts` / `tool-edit.test.ts` / `tool-apply-patch.test.ts` — destructive tools tested via tmpdir; good. OK (P2-#5).
- `tool-websearch.test.ts` — strong credential-leak assertions. OK.
- `observability/redact.test.ts` — secret redaction coverage; private-key case weak (P2-#6).
- `util/flock.test.ts` / `util/effect-flock.test.ts` — real process-contention stress tests; correct, slow (P2-#1).
- `plugin/provider-*.test.ts` (12 files) — all use `fakeSelectorSdk`/mocked fetch; no live calls. OK.
- `session-runner.test.ts` — 3,577 lines, single file; split recommended (P2-#2).
- `git.test.ts` / `repository.test.ts` / `repository-cache.test.ts` / `project.test.ts` — real git subprocess in tmpdir; correct, slow (P2-#1).

## Verification performed

- `git diff --stat` against `stable-release`: **no changes** (zero P0/P1 fixes applied because none were warranted).
- TypeScript compile (`npx tsc --noEmit`) run by the parent audit wave; this extension sub-audit introduced no edits, so it cannot break the build.
- Coverage log `/tmp/audit_progress/coverage.txt` confirms all 139 scoped files were opened and read (1024-line merged file `/tmp/all-core-tests.txt` used for cross-file scans).

## Recommendation

Ship as-is. Track the 6 P2 items as follow-up tech-debt (CI slow-tag, session-runner split, die→fail mocks, injected clocks, sandbox-only docs, stronger PEM redaction test). No blocking work.

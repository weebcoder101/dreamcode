# DeepSeek Harness Integration — Bridge Plan & Status

> Branch: `test-v1.4.x-dream-harness` (fresh fork of `stable-release`)
> Vendored upstream: `deepseek-ai/deepseek-harness` (MIT, v0.1 dev preview, cloned 2026-08-14)
> Location: `vendor/deepseek-harness/`

## 1. What was adopted (already implemented on this branch)

| Pattern | Source (dsh) | Dreamcode implementation | Status |
|---|---|---|---|
| **Dream Protocol enforcement gate** | Claude Code stop-hook pattern; dsh `agent/pre-step` interception | `packages/opencode/src/session/dream-gate.ts` — blocks first mutating tool call until plan markers (`## Approach`, `## Correlations`, `## Verification`, `Phase 1-5`) are emitted; fires once per message (no deadlock) | ✅ implemented + tested |
| **Tool-call repair layer** | Command Code `parseRepairedToolInput` (proven on DeepSeek) | `packages/opencode/src/session/tool-repair.ts` — drops null optionals, parses stringified arrays, wraps bare strings, unwraps markdown auto-links, renames aliases; tagged `tool_input_repaired` so the model learns | ✅ implemented + tested |
| **Retry: full jitter + DeepSeek codes** | dsh `llm-retry` (backoff+jitter, retryableCodes, Retry-After) | `packages/opencode/src/session/retry.ts` — ±20% jitter de-synchronizes retry storms; classifies DeepSeek JSON codes `RATE_LIMIT/SERVER_ERROR/TIMEOUT/QUOTA_EXCEEDED/BUSY` as retryable | ✅ implemented |
| **Tool timeout enforcement** | dsh `guard/timeout-policy` + `util/timeout` (deadline, TimeoutReason) | `packages/opencode/src/util/timeout.ts` — `deadline()` / `timeoutOf()` primitives; `tools.ts` wraps every execute in a deadline, replacing hung tools with a structured `TOOL_TIMEOUT` result | ✅ implemented + tested |
| **KV-cache prefix ordering** | dsh `system-prompt` ordering doctrine (static first) | `prompt.ts` — static env/instructions/knowledge lead; `Today's date:` trails at the end so a daily date change does not invalidate the cached prefix | ✅ implemented |
| **Semantic doom-loop detection** | research: byte-exact DOOM_LOOP misses re-keyed inputs | `processor.ts` — `normalizeToolInput` canonicalizes key order/whitespace before comparing | ✅ implemented |
| **DeepSeek V4 agentic config** | DeepSeek's own best eval config (reasoning_effort=max, temp=1.0, top_p=0.95) | `provider/transform.ts` — deepseek defaults for temperature/topP + `reasoningEffort: "max"` base option | ✅ implemented |
| **Dream protocol system section** | dsh `deployment:persona` / section registry at order 0 | `prompt/dream-protocol.txt` imported as a stable prefix block in `prompt.ts` | ✅ implemented |
| **Self-verification gate** | Claude Code "give it a check"; SWE-agent reproduce→confirm loop | `session/verify-gate.ts` — after a turn makes edits (edit/write/apply_patch) but finishes without tests/build/lint, injects a synthetic user message forcing a verification pass; fires once per user message | ✅ implemented + tested |
| **Checkpoint flush before request** | dsh `session-checkpoint-policy` (`llm/stream` listener) | `processor.ts` `attempt` — `flushV2Fragments()` before `llm.stream` so a crash loses at most the in-flight stream | ✅ implemented |
| **Tool-discipline prompt fragments** | Claude Code verbatim system rules | `prompt/default.txt` — parallel tool calls, read-before-write, scope restraint, failure recovery, permission-denial adjustment, prompt-injection flagging | ✅ implemented |

## 2. Vendored reference (do not merge into bun workspace)

`vendor/deepseek-harness/` is a **reference checkout** — it keeps its own pnpm lockfile and is
deliberately NOT in `package.json` workspaces (Bun vs pnpm kernels are incompatible; a literal
merge is infeasible and high-risk per research). Use it to:

- Read the reference implementations listed above.
- Copy the pseudocode-level patterns into Dreamcode's Effect-based core.
- Reference the event-sourced session log (`packages/core/session`) when we add fork/resume.
- Reference Code Mode (`packages/core/agent-tool-presentation`) for the `run_code` tool.

To re-sync the vendored copy when upstream updates:
```bash
cd vendor/deepseek-harness && git init -q && git remote add origin https://github.com/deepseek-ai/deepseek-harness && git fetch origin main && git checkout main
```

## 3. Bridge to dsh as a subagent provider (not yet wired — next phase)

The research concluded Option A (tactical bridge): run the dsh binary as an **isolated external
process** and route "deep research" subtasks to it via the existing `task` tool. This delivers
dsh's Code-mode speed and V4 adapter with zero changes to Dreamcode's Effect kernel.

Steps (when we proceed):
1. Build the vendored harness: `cd vendor/deepseek-harness && corepack enable && pnpm install && pnpm run build`.
2. Verify `node apps/cli/src/bin.ts --profile headless --dump-config` works.
3. Create `packages/opencode/src/plugin/deepseek-harness.ts`: a plugin that spawns
   `dsh --profile headless` as a subprocess and exposes it as a `SubagentProvider`.
4. Wire into `packages/opencode/src/tool/task.ts` so deep-research subtasks can route to dsh.
5. Stream results back into Dreamcode's session log (reuse `SessionV1` message types).

## 4. Known gaps still open (next priorities)

- **Plan-then-act mechanical gating at the loop level** (beyond the tool-dispatch gate):
  currently the gate fires at tool-dispatch; a stronger version forces a structured
  `<plan>`+`<verify>` skeleton on non-trivial tasks before ANY tool runs (needs `step===1`
  complexity check, as upstream V2 does).
- **Code Mode (`run_code`)**: model writes TS to orchestrate tools — biggest "smarter" lever,
  medium portability.
- **Durable event log + fork/resume**: port dsh's `deriveMessages` + `fork` for branching.
- **Tool-dispatch checkpoint**: `flushV2Fragments` now runs before `llm.stream`; a parallel
  flush before each top-level tool dispatch would fully mirror dsh's `tools/execute` listener.

## 5. Verification notes

- The repo's `turbo` typecheck hangs on this machine — do NOT run it locally. Use
  `bun test` for targeted checks and a scoped `tsc -p` for type checks (see
  `docs/dreamcode-harness-verify.md`).
- All new modules have unit tests in `packages/opencode/test/session/` and
  `test/util/`.
- The unnamed "beforeEach hook timed out" in `bun test` output is a **pre-existing**
  environment artifact (present on the unmodified test file); all real assertions pass.
- Scoped `tsc -p` type checks of the changed files show only pre-existing
  `packages/core`/`packages/llm` errors (missing `bun` type defs in the minimal config)
  plus resolution artifacts that exist on the base branch too — none introduced by this work.

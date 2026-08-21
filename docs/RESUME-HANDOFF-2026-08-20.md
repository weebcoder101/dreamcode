# DreamCode Handoff — Session 2026-08-20

**Branch:** `dream-harness-fixes` · **Date:** 2026-08-20
**Purpose:** Complete record of what was done, what's half-done, what's broken, and the full plan for the Command Code mods port. Read this before touching the repo.

---

## 1. DONE — KV-Cache Cost Fixes (binary rebuilt, smoke-tested)

The user reported exorbitant costs on the Command Code API (Qwen3.7-Flash: ~127k input tokens billed at full price every turn) vs. minimal costs on the opencode GO API. Root causes and fixes below. **Binary was rebuilt and verified:**

```
packages/opencode/dist/dreamcode-linux-x64/bin/dreamcode
→ ELF x86-64, 228MB, `--version` = 1.5.0, smoke test passed
```

Build command (single-target, NOT the 12-platform default which times out):
```bash
cd /home/ronya/dreamcode && bun run --cwd packages/opencode build --single
```

### Fix 1 — `promptCacheKey` gated on GPT-5 only (THE main bug)
**File:** `packages/opencode/src/provider/transform.ts`
The `promptCacheKey = input.sessionID` assignment was INSIDE the `if (model.api.id.includes("gpt-5"))` block. Qwen/other models NEVER got a session-bound cache key → backend treated every request as a new session → full-price billing every turn.
**Fix:** moved `promptCacheKey` assignment to an unconditional block for `providerID.startsWith("opencode")`, before the GPT-5 block. Kept `include`/`reasoningSummary` GPT-5-specific.

### Fix 2 — TTL extended to 8 hours
**File:** `packages/opencode/src/provider/transform.ts` (`applyCaching` → `providerOptions`)
All cache markers (`anthropic`, `openrouter`, `bedrock`, `openaiCompatible`, `copilot`, `alibaba`) now carry `ttlSeconds: 28800` (8h) instead of defaulting to the 5-minute ephemeral default. Prevents cache expiry + full-price re-write on any idle gap > 5min.

### Fix 3 — Variant (reasoning effort / thinking) switching now BLOCKED per session
**File:** `packages/opencode/src/session/llm/request.ts`
`variantBySession: Map<string, Record<string, any>>` now LOCKS the first variant used per session. Mid-session switches are reverted to the initial variant with a `console.warn` (`[KV-CACHE] variant switch BLOCKED...`). Previously it only warned and let the switch through, busting the whole prefix cache.

### Fix 4 — Static prefix made byte-stable (skills + environment caching)
**File:** `packages/opencode/src/session/system.ts`
- Added `cachedSkills`, `cachedEnv` alongside the existing `cachedKnowledge`.
- `environment()` and `skills()` now return cached values (byte-identical across turns) instead of recomputing from disk/plugin each turn.
- Added `invalidateStaticPrefixCache()` to the `Interface` (clears both) — call sites for invalidating on skill install/config change are NOT yet wired (see TODO below).

### Supporting changes (already in tree)
- `buildSystemPrompt()` extracted into `packages/opencode/src/session/prompt-utils.ts` — orders system blocks: static (env-no-date, dream protocol, instructions, skills, self-check) FIRST, dynamic tail (knowledge, date, taste) LAST so mutation only re-bills the small tail. Byte-identity regression tests in `packages/opencode/test/session/kv-cache.test.ts` (all 27 session tests pass).
- `applyCaching()` in transform.ts picks the static-prefix boundary (last non-dynamic system message) as the single cache checkpoint for `@ai-sdk/openai-compatible`.
- `variantBySession` warning existed; upgraded to lock.

### Test status after cost fixes
```
bun test test/session/kv-cache.test.ts test/session/taste.test.ts test/session/dream-gate.test.ts
→ 27 pass, 0 fail
```

---

## 2. DONE — Subagent Model-Switch Fix (parent model being overwritten)

**Symptom:** Parent running nemotron-3-ultra-free; launching a `@general` subagent (Hy3 Free) caused the PARENT to switch to hy3-free after the subagent completed.

**Root cause (confirmed by DB inspection):** `queueSynthetic` in `packages/opencode/src/tool/task.ts` wrote the synthetic completion user-message with the model of the LAST user message (`lastUser?.info.model`) — which was the subagent's task-prompt message carrying the subagent's model. Then `currentModel()` (`packages/opencode/src/session/prompt.ts:263-282`) falls back to "the last user message with a model" → parent ran on Hy3.

**Fix:** `queueSynthetic(parent, parentModel, parts, childCost, childTokens)` now uses the passed `parentModel` (captured from the parent message `msg.info.modelID` BEFORE the subagent model is resolved) unconditionally. Both call sites (`inject` busy-branch and catch-path) pass `parentMsgModel ?? model`. The `inject` jump-start prompt also explicitly passes `model: parentMsgModel` so `createUserMessage` never re-resolves via `currentModel()` (which would trigger `ModelSwitched` and overwrite the parent DB row via `packages/core/src/session/projector.ts:403`).

**DB evidence of the bug (before fix):** parent session `ses_fe82de440ffeJx0O8o9NXxQQyy` showed assistant messages alternating `nemotron-3-ultra-free` → `hy3-free` → `auto/coding:free`, exactly matching subagent spawns. User messages carry NO model (null) — so `currentModel()`'s fallback is the whole story.

**Tests added/updated:** `test/tool/task.test.ts` — `subagent uses user-selected subagentModel over parent model` passes.

---

## 3. IN PROGRESS / BROKEN — description tests hang (`cfg` → npm install)

**Failing tests (both timeout after 5s):**
```
bun test test/tool/task.test.ts -t "description"
→ (fail) description sorts subagents by name and is stable across calls
→ (fail) description hides denied subagents for the caller
```
All other 18 task tests pass.

### Investigation trail (exact, so the next session doesn't redo it)

1. **Hypothesis A — `cfg is not defined` in plugin/index.ts:** WRONG for current tree. `cfg = yield* config.get()` was already hoisted to layer scope (line 127). Not the hang.

2. **Hypothesis B — nested InstanceState/ScopedCache deadlock in ToolRegistry pre-warm:** PARTIALLY WRONG. A minimal repro (`Effect.scoped` + nested `ScopedCache.make` + `ScopedCache.get` inside another `get`'s lookup) **passes** — nested ScopedCache does NOT deadlock in Effect 4.0.0-beta.74.

3. **Hypothesis C — the hang is in Plugin.state itself:** CONFIRMED via console.log tracing (all debug logs now removed). The path is:
   ```
   registry.tools() → InstanceState.get(toolRegistryState)
   → ToolRegistry.state → plugin.list() → InstanceState.get(pluginState)
   → Plugin.state:
       bridge made ✓
       server imported ✓
       client created ✓
       internal plugins loaded ✓ (all 10, incl. SensorGateEnforcer)
       startGateRefresh ✓
       external plugins: 1
       → config.waitForDependencies() ← HANGS HERE
   ```

4. **Root cause (definitive):** `Plugin.state` sees `cfg.plugin_origins` with **1 external plugin** and calls `config.waitForDependencies()` (plugin/index.ts:181). `waitForDependencies` (`config/config.ts:623-627`) joins `s.deps` fibers. Those fibers are `npmSvc.install(dir, { add: ["@opencode-ai/plugin"] })` spawned in `config/config.ts:443-462` for each config directory. In a fresh test tmpdir there is no `node_modules`, so **arborist runs a real npm install** (`packages/core/src/npm.ts:147-157` → `reify` → network) which hangs/never completes → `waitForDependencies` never returns → Plugin.state never completes → ToolRegistry.state never completes → test times out.

### The fix (NOT yet applied — test-layer change only)
There is already a noop Npm mock at `packages/opencode/test/fake/npm.ts`:
```ts
export const noop = Layer.mock(Npm.Service)({ install: () => Effect.void })
```
Used by `test/config/config.test.ts`, `test/plugin/trigger.test.ts`, `test/plugin/workspace-adapter.test.ts`, `test/agent/plugin-agent-regression.test.ts`.

**Apply to `test/tool/task.test.ts`:**
```ts
import { NpmTest } from "../fake/npm"
// inside the layer():
Layer.provide(NpmTest.noop),  // add to the mergeAll
```
This makes `npmSvc.install` a no-op → the `deps` fibers complete instantly → `waitForDependencies` returns → Plugin.state completes → description tests should pass.

**Do NOT** try to fix this in src (registry.ts pre-warm / plugin state / fork tricks) — the earlier attempts (forkIn, forkScoped, forkDetach, Effect.scoped, timeboxed option-warmup) all failed because the hang is the npm install, not a scope deadlock. Revert any such src changes if re-introduced.

### The earlier task.test.ts layer change (already in tree) — keep it
The test layer was changed to:
```ts
Layer.succeed(PluginBoot.Service, { wait: () => Effect.void }),   // PluginBoot stub
LayerNode.buildLayer(LayerNode.group([Session.node, SessionProjector.node, Database.node])),
```
This fixed a projector race (SessionProjector.defaultLayer provides its OWN EventV2.defaultLayer → separate buses). The `LayerNode.group` shares one EventV2. Keep this.

### Verification after fix
```bash
cd /home/ronya/dreamcode/packages/opencode && bun test test/tool/task.test.ts   # expect 20 pass, 0 fail
bun test test/session/kv-cache.test.ts test/session/taste.test.ts test/session/dream-gate.test.ts  # still 27 pass
```
Then rebuild the binary (Fix section 1 command) and smoke test `--version` → 1.5.0.

---

## 4. TODO / NOT DONE — cost-fix follow-ups (optional)

- **`invalidateStaticPrefixCache` not wired:** the new method exists on `SystemPrompt.Interface` (`system.ts`) but nothing calls it on skill install / config change. If a skill is installed mid-session, `cachedSkills` stays stale until process restart. Wire it into the skill install path if freshness matters (trade-off vs. KV stability).
- **OmniRoute config already added** to `~/.config/dreamcode/config.json` (114 models under `provider.omniroute`, `@ai-sdk/openai-compatible`, `http://localhost:20128/v1`). Not part of this repo — do not commit.

---

## 5. BIG TASK (planned, not started) — Port DreamCode skills / auto-skill-loading / dream gate to Command Code as MODS

### Goal
The user wants the DreamCode harness's **skill system, auto skill loading, and dream gate** exported to the Command Code CLI using **Mods** (the `@commandcode/harness` ModApi). Command Code mods are single TypeScript files in `~/.commandcode/mods/*.ts` (or `<project>/.commandcode/mods/`), jiti-loaded, no build step, `export default function (cmdc: ModApi)`.

### Key ModApi surfaces available (from the mods reference the user pasted)
- `cmdc.hooks({ ... })` — mutating lifecycle: `beforeToolCall`, `afterToolCall`, `appendSystemPrompt`, `transformContext`, `transformInput`, `onStop`, `onTurnStart/End`, `onRunEnd`, `onSessionStart/End`, `prepareNextTurn`, `shouldStopAfterTurn`.
- `cmdc.addTool({schema, run})` — model-callable tools (`run` receives `{input, runtime, signal}`; return `{ok: true, content:[{type:"text",text}]}` or `{ok:false, error}`).
- `cmdc.addCommand({name, description, handler})` — `/slash` commands returning `{prompt}` or `{message}`.
- `cmdc.on(event, handler)` — observe AgentEvents (turn_end, tool_completed, subagent_start/stop, compaction_done, ...).
- `cmdc.addProvider({id, transport, auth, model list})` — model providers.
- `cmdc.ui` — notify / confirm / select / input / setStatus / widget.
- `cmdc.events` — cross-mod pub/sub.
- `cmdc.session` — persistence (`appendCustomEntry`, `appendCustomMessageEntry`, `getCustomEntries`).
- `cmdc.addRenderer(customType, data => lines)` — custom feed rows.
- `cmd.exec({command, args})` — run processes through the harness Runtime.
- **`appendSystemPrompt` contract:** MUST be byte-stable across rounds for the same durable inputs — the provider's prompt-prefix cache keys off the system prompt bytes. This is the KV-cache discipline, directly applicable.

### What to port (DreamCode source → Command Code mod)

**A. Skill system** (DreamCode source: `packages/opencode/src/skill/`, `packages/opencode/.dreamcode/skills/*/SKILL.md`, `docs/skills.md`)
- DreamCode skills live at `.dreamcode/skills/<name>/SKILL.md` (markdown instructions + optional scripts) and are loaded via a `skill` tool (see `scanForSkillToolCalls` in `src/session/prompt-utils.ts` for the `[SKILLS LOADED]` acknowledgment pattern).
- Command Code equivalent: skills are natively supported in Command Code already; the port should expose DreamCode's skill SKILL.md files as Command Code skills, plus a `/skill`-style loading flow.
- Port the **skill manifest → available() → fmt()** flow (`Skill.fmt(list, {verbose:true})` in `src/session/system.ts`).
- Export the bundled DreamCode skills (`.dreamcode/skills/*`) into the mod (either inline or by reading from disk relative to `cmdc.cwd`).

**B. Auto skill loading / sensor gate** (DreamCode source: `src/session/prompt.ts` sensor-gate block, `src/skill/sensor-gate.ts`, `src/skill/sensor-gate-enforcer.ts`, `src/skill/chain-executor.ts`)
- The sensor gate classifies each user message and produces a mandatory skill chain; unloaded chain skills are injected as `<skill-chain-obligation>` / `<skill-loading-gap>` system blocks, and the agent must call `skill` until `[SKILLS LOADED]` (see `injectSkillChainObligation`, `injectSkillLoadingGap`, `buildUnloadedChainBlockMessage`, `getUnloadedChainSkills` in `src/session/prompt-utils.ts`).
- Command Code mapping: `cmdc.hooks.transformInput` to classify the user message → `cmdc.hooks.beforeToolCall` to block non-skill tools until the chain is loaded (like the review-guard example) → `cmdc.hooks.appendSystemPrompt` to inject the `<skill-chain-obligation>` block (byte-stable!) → `cmdc.addTool` for a `skill` tool that loads SKILL.md content into the conversation.
- The `[SKILLS LOADED]` acknowledgment scan → `cmdc.on('tool_completed')` watching for the `skill` tool name.

**C. Dream gate** (DreamCode source: `src/session/dream-gate.ts`, `src/session/dream-gate-learn.ts`, `src/tool/dream-gate-learn.ts`, `docs/HARNESS-IMPROVEMENT-PLAN.md`)
- The dream gate requires the agent to emit a plan (## Approach / ## Correlations / ## Verification) BEFORE any mutating edit; per-file tracking; `ast-edit` bypassed; consolidates edits. See AGENTS.md "Dream Gate Workflow" section and `gateToolCall` in `src/session/dream-gate.ts` (tests: `test/session/dream-gate.test.ts`).
- Command Code mapping: `cmdc.hooks.beforeToolCall` — block mutating tools (write/edit/apply_patch) when the accumulated assistant text lacks the plan markers, with `additionalContext` as the block reason (exactly the documented `{block: true, additionalContext}` pattern). Track planned files in a closure (or `cmdc.session.appendCustomEntry` for durability).
- The per-file plan tracking needs the assistant's accumulated text → Command Code's `beforeToolCall` receives `state`; the text may need accumulation via `cmdc.on('text_delta')` or the hook's state access.
- The dream-gate-learn (failure-driven compression) is a follow-up — likely too heavy for v1 mod; note as future work.

### Recommended mod file layout
```
~/.commandcode/mods/dream-skills.ts       — skill tool + manifest + auto-loading obligation blocks
~/.commandcode/mods/dream-gate.ts         — plan-before-edit gate (beforeToolCall blocker)
~/.commandcode/mods/dream-sensor.ts       — sensor gate classification + skill chain enforcement
```
Or one `dream-harness.ts` if the user prefers a single file. Keep each mod self-contained; use `cmdc.session` for durable state; follow the **"appendSystemPrompt must be byte-stable"** rule.

### Verification loop (from mods docs)
1. `cmdc --mod ./dream-gate.ts` (no install needed).
2. `cmdc mods list` — must show the mod with no load warnings.
3. Exercise: ask the model to edit without a plan → expect block reason as tool result; load a skill → expect the obligation block; etc.
4. `/reload` after edits (mods load once per process).
5. Headless: `cmdc -p "..." --mod ./your-mod.ts` (confirm → false; blockers must degrade gracefully).

### Research notes / gotchas
- **Effect 4.0.0-beta.74** is the runtime (from `node_modules/.bun/effect@4.0.0-beta.74`). `Effect.fork`/`forkDaemon` do NOT exist → use `Effect.forkIn(scope)` / `Effect.forkScoped`. Confirmed by `src/skill/self-evolve.ts` self-docs.
- Nested `ScopedCache.get` does NOT deadlock in this version (minimal repro passed) — do not chase that ghost again.
- The description-test hang is 100% the npm install inside `config.waitForDependencies()` (section 3) — apply the `NpmTest.noop` layer fix.
- Command Code mods are **line-based rendering** — no React components in renderers.
- Project mods are trust-gated; user-scope and `--mod` mods always load.

---

## 6. How to resume (TL;DR for a fresh session)

1. **Fix the 2 description tests:** add `Layer.provide(NpmTest.noop)` to the layer in `packages/opencode/test/tool/task.test.ts` (import from `../fake/npm`). Run `cd packages/opencode && bun test test/tool/task.test.ts` → expect 20 pass.
2. **Rebuild binary** (cost fixes + model-switch fix are already in src): `cd /home/ronya/dreamcode && bun run --cwd packages/opencode build --single` → verify `packages/opencode/dist/dreamcode-linux-x64/bin/dreamcode --version` = 1.5.0.
3. **Port to Command Code mods** per section 5 — start with `dream-gate.ts` (smallest, well-tested logic in `src/session/dream-gate.ts`), then `dream-skills.ts`, then `dream-sensor.ts`.
4. Optionally wire `invalidateStaticPrefixCache` (section 4).

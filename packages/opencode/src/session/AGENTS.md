# Session Package Learnings

## Persona System

### Configuration
- `MAX_PERSONA_ROUNDS = 3` (prompt.ts) - Maximum rounds of specialist analysis
- `RATE_MAX_SPAWNS = 5` — Max persona spawns per 5-minute rolling window
- `RATE_WINDOW_MS = 5 * 60 * 1000` — 5-minute rate limit window
- `personaRoundMap` tracks rounds per session
- `sensorGateFiredMap` persists across messages
- `spawnHistory` tracks spawn timestamps for rolling-window rate limiting

### Spawn Necessity Evaluation
- `evaluateSpawnNecessity()` in sensor-gate.ts checks BEFORE spawning:
  - Task complexity (risk level, confidence, mode)
  - Domain diversity (single vs multi-domain)
  - Prompt characteristics (length, code blocks)
  - Chain complexity (simple vs multi-step)
- Simple tasks (high confidence, low risk, single domain) → agent handles directly
- Multi-domain, high-risk, complex chain tasks → specialists spawned

### Rate Limiting (Runtime Enforced)
- 5 spawns per 5-minute window per session (rolling window)
- Checked in code, not just prompt text — hard enforcement
- Agent sees `<rate-budget>` in system prompt for self-regulation
- When limit hit: `<rate-limit>` warning injected, task handled directly

### Efficiency Rules
- Agent should complete analysis in ONE round if possible
- Only spawn additional specialists if CRITICAL gaps exist
- Each round of spawning costs time and money
- Most tasks should complete in 1 round
- Use round 2 only for critical gaps
- Round 3 is FINAL - task tool gets disabled

### Synthesis Instructions
- When all specialist results arrive, IMMEDIATELY synthesize findings
- Check: Do findings cover ALL aspects of the user's request?
- If YES: IMPLEMENT NOW. Do not spawn more specialists.
- If NO: Spawn ONLY the missing specialist(s)
- After any gap-filling round, you MUST implement. No further spawning

### `parseExplicitSpawnCount()` — user override of sensor gate (prompt.ts:195-198)

A regex `/(spawn|use|run|deploy) (\d+) (agent|subagent|specialist|persona)/i` parses explicit
"spawn N agents" from user text. If matched, it overrides `evaluateSpawnNecessity()` completely:
the sensor gate's persona count is replaced with the user-requested number. If `gateResult.personas`
is empty but user explicitly requested N agents, synthetic `Persona[]` entries are created
(prompt.ts:1629-1635).

### Skill loading format changed to UUID manifest (prompt.ts:1478-1486)

Skills are no longer loaded as inline `<loaded-skill name="...">full content</loaded-skill>` blocks.
Instead, a `<skill-chain>` manifest with skill names and UUID references is injected. Agents must
use the `skill` tool at runtime to load skill content by UUID. The `skill` tool is now mandatory
for persona/specialist workflows.

### Subagent cost warning removed from system prompt

The `<subagent-cost-warning>` block (formerly at prompt.ts:1418-1437) was removed. Agents no longer
see subagent model cost hints on the first turn. Subagent model guidance is purely UI-driven now.

### `evaluateSpawnNecessity()` scoring overhaul (sensor-gate.ts:218-306)

The spawn necessity algorithm was significantly rewritten:
- **Removed**: high-confidence/low-risk auto-skip (used to skip when confidence > 0.85 && risk === "low")
- **Removed**: short conversational prompt auto-skip (used to skip when prompt < 80 chars && no code)
- **Added**: `simplicityPatterns` regex check (`/^(fix|update|change|add|remove|bump|upgrade|downgrade)\s/i`)
- **Changed**: chain-length scoring now filters out "always" skills (breakthrough-overdrive-innovation, pieces-ltm, automated-learning, lint-fixer, context-compactor) via `effectiveChainLen`
- **Changed**: `suggestedCount` can now be 0 (previously minimum was 1), allowing zero-specialist spawns
- **Changed**: multi-domain scoring: 3+ domains = +3, 2 domains = +1 (was flat +1 per domain)

### Output Requirements
- Specialists must provide structured analysis with:
  1. Summary: One paragraph overview
  2. Key Issues: Bullet list with file:line references
  3. Recommendations: Actionable fixes with code snippets
  4. Confidence: Rate confidence (High/Medium/Low)
- Be CONCISE. Focus on ACTIONABLE items only.
- Do not repeat findings from other specialists.

### Subagent Behavior
- Persona subagents get `disableTaskTool: true` via `subtaskOps`
- They CANNOT spawn their own subagents
- Background subagents have `neverAbort` flag
- Foreground subagents are NOT cancelled on parent interrupt

### EffectBridge Scope
- `EffectBridge.make()` captures parent Effect context via `Effect.provide(ctx)`
- This can cause scope capture issues across sequential persona tasks
- **FIXED**: Removed `Effect.provide(ctx)` to prevent scope capture

## LLM Integration

### Provider Turn
- One explicit `llm.stream(request)` call per provider turn
- Reload projected history before durable continuation
- Do not bridge through legacy `SessionPrompt.loop(...)`

### Tool Settlement
- Durably record each tool call before side effects begin
- Authorize and execute recorded local calls through core-owned registry hook
- Persist typed success, failure, and provider-executed tool outcomes
- Start each recorded local call eagerly and await all settlements before continuation

### Overflow Recovery
- Context overflow triggers compaction
- After compaction, rebuild through the path without overflow recovery
- Maximum 2 overflow recoveries per session

## Dream Protocol Gate

### How it works
- `dream-gate.ts:57-67` — `hasPlanMarker()` scans `SessionV1.Part[]` for text matching PLAN_MARKER_RE
- `tools.ts:118-123` — gate reads **in-memory `accumulatedText()`** (race-free) instead of the DB mirror
- `MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])` — ast-edit is NOT gated (structurally safe: byte-range, re-parse validated)
- After first block, `alreadyGated()` returns true → subsequent mutating calls allowed (course-correction, not deadlock)

### The PartDelta timing race (fixed in session.ts updatePartDelta)
- **Root cause**: `text-delta` → `updatePartDelta` only published `PartDelta` event; no projector persisted it to DB
- DB part row stayed `text: ""` (from text-start) until `text-end`'s full `updatePart`
- AI SDK executed tools fire-and-forget BEFORE text-end landed → gate always saw empty text
- **First fix**: `updatePartDelta` (session.ts:918) now writes to DB directly (read row, append delta, upsert)
- **Second fix (2026-08-17)**: The append-based write was still racy — non-atomic read-modify-write with interleaved fibers. Changed to **idempotent overwrite**: `updatePartDelta` takes `delta` (for backward-compat PartDelta events) + `value` (full accumulated text for DB overwrite). DB row still SELECTed to preserve sibling fields (metadata), but the target field is overwritten, not appended. Concurrent fibers always converge to the authoritative in-memory truth.

### Gate race fix (2026-08-17)
- **Root cause**: gate read plan text from DB mirror (`MessageV2.parts()`), but the DB is an eventually-consistent mirror that lags behind the in-memory stream
- **Fix**: `processor.ts` Handle now exposes `accumulatedText: () → string` — the authoritative in-memory text accumulated across all text-delta events
- `tools.ts` gate reads `input.processor.accumulatedText()` instead of `MessageV2.parts()` → race-free
- `MessageV2` import removed from tools.ts
- `ProcessorContext` has `accumulatedText: string` field; initialized `""` in `create()`; `text-start` appends `"\n"` separator if non-empty; `text-delta` appends `value.text`
- Handle assembly at `processor.ts:1123` exposes `accumulatedText: () => ctx.accumulatedText`

### parts6 crash (fixed)
- `Handle.message` is `SessionV1.Assistant` which has NO `.parts` field at runtime
- Initial fix used `(input.processor.message as ...).parts` → `hasPlanMarker(undefined)` → "undefined is not an object (evaluating 'parts6')"
- **Lesson**: `SessionV1.Assistant` type != runtime shape; always use `MessageV2.parts(id)` for parts

## Tool Repair

### In-memory only (KV-cache stability, 2026-08-17)
- Repair applies `repairToolInput()` in-memory for execution only — `repaired.args` feeds `item.execute()`
- DB part keeps the original (unrepaired) args so the message prefix stays byte-identical across requests
- Repair note in tool result teaches the model what the correct args should be
- Removed `updateToolCall` mutation (tools.ts:147-156) to prevent prefix cache invalidation

### Alias guard (tool-repair.ts:34)
- `ALIASES = { pattern: "glob", file_path: "path", ... }` — blind rename breaks grep/glob
- **Root cause**: `pattern` is BOTH a real schema field for grep/glob AND an alias target
- **Fix**: alias only when `sourceIsReal = false && aliasIsReal = true` (checked via `k in props`)
- **Lesson**: when aliasing param names, verify the source key isn't already a real schema field

## Config Schema

### limit.output is optional (2026-08-17)
- `limit: { context }` alone (no `output`) is valid — schema `ConfigProviderV1.Model.limit.output` is optional
- **Root cause of the `dreamcode -c` core dump**: the V1 schema required `output` whenever `limit` was present; the `cmdc` provider block in `.opencode/dreamcode.jsonc` wrote `limit: { context }` only → "Missing key ... limit.output" × 55 models, CLI aborted
- **Fix**: `output: Schema.optional(Schema.Finite)` in `packages/core/src/v1/config/provider.ts`; `migrate.ts` guards `output === undefined` (never `int(undefined)` → NaN); `transform.ts` thinking budgets clamp `Math.max(1, ...)` for output=0
- **Lesson**: when generating model configs, `limit.context` is the only hard requirement — never emit `limit.output` as NaN/undefined-forced

## Prompt System

### KV-cache system-prompt ordering (prompt-utils.ts)
- Static prefix: `[env(no-date), DREAM_PROTOCOL, instructions, skills, selfCheck]`
- Dynamic tail: `[knowledge, date, taste]` — each mutates independently, only re-bills the tail
- Knowledge was at position 5 (mid-prefix) — `selfEvolve.capture()` invalidates cache every step-1 turn → full-prefix miss (~147k tokens × $0.44/M = $0.065/turn). Moved to tail (after selfCheck) → knowledge mutations only re-bill ~2-3k tail tokens
- `buildSystemPrompt()` is the single source of truth for ordering

### Tool-call repair and KV-cache (tools.ts)
- `repairToolInput()` applies fixes in-memory only; DB part keeps original args
- Prevents `updateToolCall` from mutating the stored tool-call part between requests → message prefix stays byte-identical
- Repair note in tool result teaches the model what the correct args should be

### prompt.test.ts cascading mock gaps
- Adding new services to prompt.ts (SelfEvolve, PluginBoot) without updating test Layer → 54 "Service not found" failures
- **Pattern**: every `yield* SomeService.Service` in prompt.ts needs a corresponding Layer in test's `deps` at line 202
- SelfEvolve.defaultLayer + PluginBoot mock were the two missing ones

### processSensorGatePhase wrapper type drift
- Local wrapper at prompt.ts:298 declares its own input type; adding properties to `SensorGatePhaseInput` doesn't automatically update the wrapper
- Missing `sys` and `taskComplexity` caused TS2353 errors; stray `handle` field caused TS2345

### handle.message.parts doesn't exist
- `SessionV1.Assistant` has no `.parts` — parts live separately in the PartTable
- Correct pattern: `yield* MessageV2.parts(handle.message.id).pipe(Effect.provideService(Database.Service, database))`

### messages.transform plugin trigger type mismatch
- `plugin.trigger("experimental.chat.messages.transform")` expects `{ info: Message; parts: Part[] }[]` (SDK types)
- `msgs` is `SessionV1.WithParts[]` — structurally similar but different union members → requires cast
- Cast: `msgs as unknown as { info: import("@opencode-ai/sdk").Message; parts: import("@opencode-ai/sdk").Part[] }[]`

## Effect v4 Gotchas

- `Effect.catchAll` does NOT exist — use `Effect.catch`
- `Effect.fork` / `Effect.forkDaemon` do NOT exist — use `Effect.forkIn(scope)`
- `Effect.onInterrupt(() => fn)` — must call `fn()`, not pass reference: `() => finalizeInterruptedAssistant()` NOT `() => finalizeInterruptedAssistant`

## Taste System

### Architecture (prompt-taste.ts)
- **Capture**: 6 signal classes (explicit 1.0, correction 0.9, tool-use 0.5, comm-style 0.4-0.6, edit 0.8, workflow); junk filter (stopwords + min length) in `cleanValue`; `recordTasteEvent()` is fire-and-forget (single append), no latency in prompt path
- **Decay engine**: `decayWeight` — w = conf·0.5^(age/H); half-lives: explicit/correction 90d, tool-use/edit 30d, comm-style/workflow 2d; contradicted (superseded) values decay at 1d half-life (pass-1 latest-value detection in `accumulate`)
- **Near-dup merge + eviction**: `normVal` collapses identical normalized values; `fmtSection` keeps strongest evidence, lowest-weight evicted when over per-section cap
- **Budget**: soft 2k / hard 3k TOKENS (est. chars/4), `fitBudget` trims at a line boundary, never mid-line
- **Artifact**: `.dreamcode/taste.md` IN the project (Command Code style, shareable; manual markers preserved verbatim); raw events stay in `<data>/taste/<project-key>/events.jsonl`, rotated at consolidation (>5000 → keep last 3000)
- **Consolidation**: `consolidateTaste()` — clone-then-rewrite (.tmp → .bak → rename, Claude Dreams pattern), never mutates events; debounced (5-min floor) so it never blocks the prompt hot path; consolidation runs from `readTasteMd` (lazy) or an explicit dream trigger
- **Injection**: `summarizeTaste()` emits `<taste-profile>` block; model-agnostic, NOT gated on the sensor gate. KV-cache rule: the block lives in the DYNAMIC TAIL of the system prompt (after the date) because it mutates on consolidation — a mid-prefix mutation would invalidate the whole DeepSeek prefix cache (~31× cost).
- `recordTaste()` (sensor-gate spawn decisions) is legacy — kept for backward compat but not injected into prompt

### Data files
- `<data>/taste/<project-key>/events.jsonl` — raw episodic events (source of truth; rotated at consolidation)
- `<project>/.dreamcode/taste.md` — the consolidated, human-editable artifact (project-visible, shareable)
- `~/.dreamcode/evolution/taste.jsonl` — legacy sensor-gate signals (hollow, mostly "skipped")
- `~/.dreamcode/evolution/profile.json` — codebase-level detection (languages, stack, tests)

## Testing

### In-Memory SQLite
- Each test suite gets its own in-memory SQLite database
- Good isolation for integration tests
- No shared state between test suites

### Layer.mock
- Use `Layer.mock` for dependency injection in tests
- Mock services at the layer level, not at the function level
- Enables testing without external dependencies

### prompt.test.ts pre-existing failures (54 → 0 after mock fixes)
- `Service not found: @dreamcode/SelfEvolve` → add `SelfEvolve.defaultLayer` to deps
- `Service not found: @opencode/v2/PluginBoot` → add `Layer.succeed(PluginBoot.Service, { add: () => Effect.void, boot: () => Effect.void } as any)` to deps
- Remaining 3 timeouts are pre-existing test infrastructure timing issues (mock LLM server session state transitions)

## Build & Binary

### tsc OOM
- Full typecheck requires `NODE_OPTIONS="--max-old-space-size=8192"` or it crashes with heap OOM
- The 18 pre-existing errors: 12 in `dist/.../tui-smoke.tsx` (generated plugin) + 6 in prompt.ts

### bin/dreamcode
- Static bash wrapper (327 bytes), NOT a symlink — resolves `BASH_SOURCE` and execs `../dist/dreamcode-linux-x64/bin/dreamcode`
- `--version` returns the version from package.json (currently `1.5.0`)

### Bundle contains
- 35 skills in `dist/.../bin/skills/` (copied from `src/skill/dreamcode/skills/`)
- 3 plugins in `dist/.../bin/plugins/` (copied from `.opencode/plugins/`)
- `deep-research.txt` text-imported at compile time (changes require rebuild)

### Edit/write tool crash in binary
- Both `edit` and `write` are in `MUTATING_TOOLS` → gated by dream gate
- If gate is broken (parts6 crash), both tools crash with the same error
- `ast-edit` is NOT in `MUTATING_TOOLS` → never gated by dream gate (structurally safe, no plan required)

### Dream Gate Workflow (CRITICAL)
The dream gate **requires all three in a SINGLE message, in this exact order**:
1. **Correlation tool call FIRST** — `relations` (dependentsOf/consumersOf/whoProvides) or `lsp` (goToDefinition/documentSymbol) on the target file. This lets the model see the call graph before planning.
2. **Plan text** — Must include `## Approach`, `## Correlations`, `## Verification` (or bare `Approach`/`Correlations`/`Verification` keywords at line start).
3. **Edit tool call** — The actual `edit`/`write`/`apply_patch`.

**Failure pattern**: If you emit plan + correlation in one message, then edit in the next — the gate resets and blocks. The correlation, plan text AND edit MUST be in the same message/response.

**Correct single-message pattern:**
```
⚙relations [dependentsOf <target-file>]

## Approach
[what you'll do]

## Correlations
[which files, what depends on them]

## Verification
[how you'll verify]

←Edit <target-file> [oldString] [newString]
```

**If blocked**: Re-emit the FULL correlation + plan text + edit in the NEXT message — do not just retry the edit.

**Note**: This documentation is version-controlled (committed to git) and injected into the system prompt for all agents.

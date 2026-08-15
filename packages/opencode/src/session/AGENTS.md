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
- `tools.ts:121-127` — gate reads parts via `MessageV2.parts(input.processor.message.id)` with `Effect.catch(() => Effect.succeed([]))`
- `MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])` — ast-edit is NOT gated
- After first block, `alreadyGated()` returns true → subsequent mutating calls allowed (course-correction, not deadlock)

### The PartDelta timing race (fixed in session.ts updatePartDelta)
- **Root cause**: `text-delta` → `updatePartDelta` only publishes `PartDelta` event; no projector persists it to DB
- DB part row stays `text: ""` (from text-start) until `text-end`'s full `updatePart`
- AI SDK executes tools fire-and-forget BEFORE text-end lands → gate always sees empty text
- **Fix**: `updatePartDelta` (session.ts:918) now writes delta to DB directly (read row, append delta to data.text, upsert)
- `text-end`'s `updatePart` then overwrites with the final accumulated text (idempotent)

### parts6 crash (fixed)
- `Handle.message` is `SessionV1.Assistant` which has NO `.parts` field at runtime
- Initial fix used `(input.processor.message as ...).parts` → `hasPlanMarker(undefined)` → "undefined is not an object (evaluating 'parts6')"
- **Lesson**: `SessionV1.Assistant` type != runtime shape; always use `MessageV2.parts(id)` for parts

## Tool Repair

### Alias guard (tool-repair.ts:34)
- `ALIASES = { pattern: "glob", file_path: "path", ... }` — blind rename breaks grep/glob
- **Root cause**: `pattern` is BOTH a real schema field for grep/glob AND an alias target
- **Fix**: alias only when `sourceIsReal = false && aliasIsReal = true` (checked via `k in props`)
- **Lesson**: when aliasing param names, verify the source key isn't already a real schema field

## Prompt System

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
- **Capture**: 6 signal classes (explicit, correction, tool-use, comm-style, workflow)
- **Consolidation**: `consolidateTaste()` — evidence accumulation with 30-day half-life decay, EVIDENCE_THRESHOLD=1.5, PROFILE_CAP=20
- **Injection**: `summarizeTaste()` — lazy consolidation (10-min throttle), emits `<taste-profile>` block, drops entries redundant with `<codebase-profile>` (ETH AGENTS.md study: bloat hurts ~3% + 20% cost)
- `recordTasteEvent()` is fire-and-forget (single append), no latency in prompt path
- `recordTaste()` (sensor-gate spawn decisions) is legacy — kept for backward compat but not injected into prompt

### Data files
- `~/.dreamcode/evolution/taste.jsonl` — legacy sensor-gate signals (hollow, mostly "skipped")
- `~/.dreamcode/evolution/taste-events.jsonl` — episodic taste events (the real signal)
- `~/.dreamcode/evolution/taste-profile.json` — consolidated dense preference profile
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
- `ast-edit` is NOT in the set → always works (used as workaround during gate debugging)

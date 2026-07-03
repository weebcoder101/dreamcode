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

## Testing

### In-Memory SQLite
- Each test suite gets its own in-memory SQLite database
- Good isolation for integration tests
- No shared state between test suites

### Layer.mock
- Use `Layer.mock` for dependency injection in tests
- Mock services at the layer level, not at the function level
- Enables testing without external dependencies

## Self-Evolution / Knowledge Persistence

### Evolution Directory Files
- `~/.dreamcode/evolution/knowledge.jsonl` — local knowledge base for `<learned-knowledge>` block
- `~/.dreamcode/evolution/run_log.jsonl` — execution trace log with `whatWorked`/`whatFailed`/`whatToChange`
- `~/.dreamcode/evolution/pieces_writes.jsonl` — audit trail for Pieces LTM persistence calls
- `~/.dreamcode/evolution/agent_score.json` — gamification scoring (from sensor_gate.py)

### SelfEvolve.capture() writes to TWO backends:
1. **Local file** (`knowledge.jsonl` + `run_log.jsonl`) — always works, no dependencies
2. **Pieces LTM** — optional, requires Pieces OS running at `localhost:39302`

### `injectChainGapDetection` return type (prompt.ts:156-162)
Must be `Generator<Effect<void, never, never>, void, any>` (not `Effect.Effect<void>`) because `function*` returns a Generator, not an Effect. TypeScript 7+ catches this mismatch.

## CWD-Independent Path Resolution

### python-resolver.ts rules:
- `resolveSkillsDir()` must NOT use `process.cwd()` — skills are resolved from:
  1. Binary-adjacent `skills/` dir
  2. `~/.config/dreamcode/skills/`
  3. `~/.dreamcode/.dreamcode/skills/` (install dir)
  4. `~/.dreamcode/skills/`
- `resolveScript()` only uses resolved skills dir, never CWD
- `validateScriptPath()` uses HOME-based paths, not CWD

### tool/skill.ts rules:
- `findSensorGate()` only uses resolved `SKILLS_DIR` — no `process.cwd()` fallback

## Windows Build

### .exe extension
- `build.ts` outputs `dreamcode.exe` for `win32` targets (via `outExt` variable)
- `install.ps1` checks for `dreamcode.exe` and falls back to `dreamcode` (no extension)
- Bun's `--compile` on Windows may or may not auto-add `.exe` — the code handles both

## Bill Gates Persona

### Trigger criteria
- `WINDOWS_QUESTIONS` array contains 60 Windows-related terms/patterns
- `isWindowsRelated(prompt)` checks prompt against all patterns + backslash-path regex
- Fires as ADDITIONAL persona in `selectPersonas()` and `classify()` fallback
- Bill Gates never replaces other personas — always appended

### Sensor_gate.py deploy sync
- Source of truth: `packages/opencode/src/skill/dreamcode/skills/.../sensor_gate.py`
- Must be MANUALLY synced to deployed copies:
  - `~/.config/dreamcode/skills/...` (runtime)
  - `~/.dreamcode/.dreamcode/skills/...` (install dir first-run sync source)
  - `~/.dreamcode/.opencode/skills/...` (legacy)
- The `emit_plan` function uses `chain_result.get("mode", "DREAM_INNOVATION")` — NOT `detected_tasks`

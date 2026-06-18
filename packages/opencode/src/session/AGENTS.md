# Session Package Learnings

## Persona System

### Configuration
- `MAX_PERSONA_ROUNDS = 3` (prompt.ts:150) - Maximum rounds of specialist analysis
- `personaRoundMap` tracks rounds per session (prompt.ts:149)
- `sensorGateFiredMap` persists across messages (prompt.ts:148)
- No persona count cap — all personas from sensor gate are spawned

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

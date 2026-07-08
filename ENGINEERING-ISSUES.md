# Engineering Issues & Solutions

## TDZ (Temporal Dead Zone) Errors in Bun Bundles

### Issue
Bun's scope-hoisting bundler flattens multi-module projects into a single scope. When `export const` declarations from separate modules are merged, Bun may reorder them such that a variable is accessed before its initialization, causing:

```
ReferenceError: Cannot access 'handle2' before initialization
```

The `handle2` name is Bun's internal rename of a variable during minification. The actual variable could be `handleSubtask`, `handleSubtaskFn`, or any `handle*`-prefixed export.

### Solution
Replace `export const` with `export var` in extracted module files. `var` declarations are hoisted to the top of their scope with `undefined` initialization (no TDZ), while `const`/`let` have a temporal dead zone until the declaration line is reached.

**Files affected:** `prompt-subtask.ts`, `prompt-sensor-gate-phase.ts`, `prompt-command.ts`, `prompt-user-message.ts`, `prompt-title.ts`, `prompt-shell.ts`

### Prevention
When extracting code into separate modules that will be Bun-bundled, use `export var` for any value that might be referenced across module boundaries during initialization. Functions declared with `function` keyword are hoisted and safe.

---

## Black Screen / Desync from `return "continue"` in Effect Generator

### Issue
The refactored `prompt.ts` added a "Per-Turn Chain Enforcement" block that checked if the agent had loaded required chain skills. When unloaded skills were detected, it injected a hard-block assistant message and used `return "continue"` to skip the LLM turn.

`return "continue"` returns from the Effect generator, which propagates as the Effect's resolved value all the way up to the HTTP handler. The handler tries to JSON-serialize this string as a session response, corrupting the SSE event stream. The frontend sync processes the garbage data and wipes the message store (black screen / desync).

### Solution
Remove the premature return. The enforcement should inject the hard-block message and let the while-loop `continue` normally, so the LLM turn processes with the block instruction visible. Never use `return` from an Effect generator as a flow-control mechanism — it produces an unexpected resolved value that the calling code (HTTP handler, task runner) cannot handle.

### File Changed
`packages/opencode/src/session/prompt.ts`: Removed the pre-turn hard block (lines 660-702 in the refactored version) that called `return "continue"` when chain skills were unloaded. The post-turn log warning (which only logs, doesn't block) was kept.

### How to Re-Implement Correctly
Instead of:
```typescript
if (preTurnBlocked) {
  return "continue" as const  // ❌ returns from generator, corrupts SSE
}
```

Use:
```typescript
if (preTurnBlocked) {
  continue  // ✅ skips to next while(true) iteration, LLM runs normally
}
```

---

## Subagent `sessionId` Missing from Metadata (General Persona Tasks)

### Issue
When "general" persona subagents completed, the Task part's `state.metadata.sessionId` was `undefined` (non-string), preventing navigation to the child session. The `processSensorGatePhase` function's completion handler overwrote metadata without preserving the `sessionId` set by the TaskTool.

Root cause: the `updatePart` completion function in `processSensorGatePhase` spread `{ ...st.metadata, persona: persona.name }` without including `result.metadata` from the TaskTool return value. The TaskTool's `result.metadata` contains `sessionId`, which was lost during completion.

### Solution
Add a `resultMetadata` parameter to `updatePart` and spread it:
```
( status, output, resultMetadata?) → metadata: { ...st.metadata, ...resultMetadata, persona: ... }
```

### File Changed
`packages/opencode/src/session/prompt.ts` (`processSensorGatePhase`): Updated `updatePart` signature and caller.

---

## Prompt Monolith vs Refactored: 25 Behavioral Differences

The extracted prompt files from main have ~25 behavioral differences from the WIP monolith. The critical ones:

| # | Difference | Impact |
|---|-----------|--------|
| 9 | Per-turn chain enforcement with `return "continue"` | **Caused desync/black screen** |
| 3 | Synthesis injection: `Effect.runPromise` vs direct Effect | Fixed in refactored (no silent failures) |
| 2 | Sensor gate re-fire: `step===1` guard removed | Changed behavior |
| 6 | Cost/token accumulation: inline vs atomic Ref | Refactored is correct (no race) |
| 19 | `finalizeInterruptedAssistant` cost preservation | Refactored preserves cost/tokens |
| 1 | `sensorGateFiredMap.set()` not called | Changed behavior |
| 5 | `resultMetadata` propagation in `updatePart` | Fixed subagent clickability |

Keep this list in mind when deciding whether to port refactored files — some changes are bugfixes, others introduce new functionality that may interact unexpectedly with the TUI sync layer.

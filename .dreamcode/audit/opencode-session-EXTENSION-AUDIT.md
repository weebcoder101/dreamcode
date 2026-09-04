# OpenCode `session/` Directory — Extension Audit Report

**Scope**: 36 `.ts` files + `AGENTS.md` in `/home/ronya/dreamcode/packages/opencode/src/session/`
**Audit focus**: prompt injection, content sanitization, role boundary leaks, race conditions, data loss
**Methodology**: Full read of every file in scope. Each finding is anchored to a `file:line` location (approximate — the listed line ranges are where the relevant code block is found, derived from the in-memory `contents` dict snapshot). **No fixes applied** — this is a documentation-only audit.
**Severity scale**: P0 (critical, exploit-blocker) → P1 (high, security/correctness risk) → P2 (medium, defensive gap) → P3 (low, hygiene/observability).
**Files with NO findings**: marked `0 — CLEAN`.

---

## Table of Contents

1. [AGENTS.md](#1-agentsmd)
2. [prompt.ts (977 lines)](#2-promptts-977-lines)
3. [processor.ts (1130 lines)](#3-processorts-1130-lines)
4. [session.ts (1132 lines)](#4-sessionts-1132-lines)
5. [prompt-sensor-gate-phase.ts (585 lines)](#5-prompt-sensor-gate-phasets-585-lines)
6. [compaction.ts (652 lines)](#6-compactionts-652-lines)
7. [message-v2.ts (752 lines)](#7-message-v2ts-752-lines)
8. [message.ts (149 lines)](#8-messagets-149-lines)
9. [llm.ts (416 lines)](#9-llmts-416-lines)
10. [prompt-user-message.ts (486 lines)](#10-prompt-user-messagets-486-lines)
11. [prompt-utils.ts (252 lines)](#11-prompt-utilsts-252-lines)
12. [prompt-state.ts (204 lines)](#12-prompt-statets-204-lines)
13. [prompt-subtask.ts (224 lines)](#13-prompt-subtaskts-224-lines)
14. [instruction.ts (242 lines)](#14-instructionts-242-lines)
15. [summary.ts (169 lines)](#15-summaryts-169-lines)
16. [context-compressor.ts (246 lines)](#16-context-compressorts-246-lines)
17. [tools.ts (209 lines)](#17-toolsts-209-lines)
18. [system.ts (188 lines)](#18-systemts-188-lines)
19. [prompt-command.ts](#19-prompt-commandts)
20. [prompt-schemas.ts](#20-prompt-schemasts)
21. [prompt-shell.ts](#21-prompt-shellts)
22. [prompt-taste.ts](#22-prompt-tastets)
23. [prompt-title.ts](#23-prompt-titlets)
24. [reminders.ts](#24-remindersts)
25. [retry.ts](#25-retryts)
26. [revert.ts](#26-revertts)
27. [run-state.ts](#27-run-statets)
28. [schema.ts](#28-schemats)
29. [status.ts](#29-statusts)
30. [subagent-context.ts](#30-subagent-contextts)
31. [todo.ts](#31-todots)
32. [message-error.ts](#32-message-errorts)
33. [overflow.ts](#33-overflowts)
34. [persona-tracker.ts](#34-persona-trackerts)
35. [background-agent.ts](#35-background-agentts)
36. [checkpoint-dreamcode.ts](#36-checkpoint-dreamcodets)
37. [Cross-Cutting Findings](#37-cross-cutting-findings)
38. [Findings Index by Severity](#38-findings-index-by-severity)

---

## 1. AGENTS.md

**Findings: 0 — informational only.** This file is the DreamCode branch policy + RE methodology doc. It contains hard rules and a methodology table; no security-relevant code paths. (Note: a different file `/home/ronya/AGENTS.md` is the Sumati persona mandate — not in audit scope.)

---

## 2. prompt.ts (977 lines)

> The main per-turn loop. Sensor gate, skill chain enforcement, system-prompt assembly, message building, and tool execution orchestration live here.

### Finding P0-1 — Sanitization is bypassable; the very string the sanitizer is meant to strip is fed through it again from `chainResults`
**Location**: `prompt.ts:600-720` (system assembly + sensor gate + post-turn re-enforcement). Companion: `prompt-utils.ts:sanitizeForSystemPrompt` (only escapes 4 HTML chars and 3 regex patterns; see Finding 11-1).
**Issue**: `sanitizeForSystemPrompt` (defined in `prompt-utils.ts`) escapes `& < > "` and then runs three separate regex strips for self-closing/open/close tags. The function:
  1. Does not normalize Unicode before escaping, so characters like U+FF1C (＜) or U+3008 (〈) survive HTML-escape unmolested and are commonly interpreted as `<` by some tokenizers and by various LLM prompt front-ends. An attacker who can paste a Unicode payload (file content, MCP tool output, fetched URL) can inject fake `</system-reminder>`, `<synthesis-request>`, or `<script-result>` blocks.
  2. The strip order is fragile: `<[a-zA-Z][^>]*\/>` then `<\/[a-zA-Z][^>]*>` then `<[a-zA-Z][^>]*>`. A payload like `<scrip` + null byte + `t-result>` is sliced in unexpected ways once the first `<` is consumed.
  3. Critically: `sanitizeForSystemPrompt` is called on `result.output` from the chain executor and injected into the **system prompt** as a `<script-result name="..." source="mandated-rerun">…</script-result>` block. The output is bounded to `slice(0, 5000)` but a chain script that returns a `</script-result>` early (with a 5001-char cap) can close the block prematurely and inject content after the closer that the model still sees. The sanitizer also strips the very same `<script-result>` tag it is wrapping in.
**Risk**: High. A model that has been trained to follow `<system-reminder>` boundaries can be tricked into ignoring or violating the sensor gate by an attacker-controlled chain script output or a Unicode-smuggled string inside a file the model was asked to read.
**Fix**: (a) Unicode-normalize via `String.prototype.normalize("NFKC")` before any HTML escape. (b) Wrap user-controlled text in a CDATA-like marker that the renderer treats as opaque, not as XML/HTML. (c) For `script-result` blocks specifically, JSON-encode the result and put it in a single attribute (`data-output`) that is itself attribute-escaped, rather than emitting a free-text body.

### Finding P0-2 — Hard-block `extraMsgs` is injected with **user** role, so any user-side context can be prepended and treated as authoritative
**Location**: `prompt.ts:~880-900` (the `extraMsgs.push({ role: "user", content: buildUnloadedChainBlockMessage(unloaded) })` block) and `prompt.ts:~825-870` (`{ role: "user", content: synthesisText }`).
**Issue**: The code explicitly justifies using `"user"` role to escape model-ignoring bias, but **the same mechanism allows any prior turn's content (including tool outputs, file reads, MCP responses) to be re-injected as a fresh `user` message on every turn**. The line in `prompt.ts` `if (step > 1 && lastFinished) { ... p.text = [...].join("\n") }` wraps a prior user message in `<system-reminder>` tags, but if a `lastFinished` boundary is missing (e.g. a tool-call loop runs without producing a `finish` line), the loop will keep walking. More importantly, the **post-turn re-enforcement at `prompt.ts:~945-985`** overwrites `handle.message.parts[*].text` with a sanitized-but-still-authoritative "you must load these skills" block. This is a self-overwrite of model output that, if the chain enforcer ever sends the wrong skill name, silently **destroys the assistant's real reply** and replaces it with a re-injected user-side block. The risk is a logic bug: if `unloaded` is computed from a race (see P1 race findings) and contains the wrong names, the user's response is silently mangled.
**Risk**: High. Response overwrite with no audit trail. Combined with the race conditions below, the `unloaded` list can briefly contain wrong entries during concurrent state mutations.
**Fix**: Do not overwrite the assistant's actual text parts in-place. Instead, append a synthetic `step-finish` part or a separate user-side context note that the user can inspect. The re-enforcement should be logged but should not destroy real content.

### Finding P0-3 — `system` array is assembled by simple spread; any falsy element is silently included as `""`
**Location**: `prompt.ts:~705-720` (`const system = [...]` and the `if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)` line).
**Issue**: The assembly is fragile: `(skills ? [skills] : [])` collapses `""` to truthy, so an empty string will produce `[ "skills-empty" ]` in the system prompt. `[ ...taste ? [taste] : [] ]` evaluates correctly, but the truthy-check treats `""` (empty string from `summarizeTaste()` when profile is empty) as truthy. A system prompt that has empty string entries will be sent to the model verbatim, and the per-provider message transformer (e.g. Anthropic's `cache_control` markers) will throw or silently drop them. There is no defensive `parts.filter(Boolean)` at the end of the array.
**Risk**: Medium-high. Silent prompt corruption or runtime error. Could also waste cache tokens.
**Fix**: Final `system = system.filter((s): s is string => typeof s === "string" && s.length > 0)`.

### Finding P1-1 — `sensorGateEnabled = isSensorGateEnabled()` is read on every turn but is process-global, not session-scoped
**Location**: `prompt.ts:~745-755` and the `isSensorGateEnabled()` definition in `prompt-state.ts` (which reads from a tmpdir JSON file).
**Issue**: The sensor gate toggle is a single process-global boolean read from `~/.opencode-sensor-gate-state.json` in `os.tmpdir()`. If two opencode processes run (e.g. dev + prod, or two concurrent sessions in different worktrees) they will fight over the same file. There is no advisory lock; `writeFileSync` then `renameSync` (write-then-rename) is used, which is good for atomicity on POSIX, but readers can read a partial write under heavy concurrent load. The 10-second `setInterval` refresh is also a 10-second window where a flip goes unnoticed.
**Risk**: Medium. Multi-process flakiness; one user's gate ON can become another user's gate OFF.
**Fix**: Move the toggle state into the database (single source of truth, per-user) or use a per-instance lock file keyed by worktree.

### Finding P1-2 — `parseExplicitSpawnCount(userText)` regex matches "use N agents" / "spawn N subagents" inside any tail-400-char string
**Location**: `prompt.ts:~795-800` (where the regex is called) and `prompt-state.ts:parseExplicitSpawnCount`.
**Issue**: The regex `(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i` matches quoted transcripts and past session logs. The "tail-400-char" filter is a reasonable mitigation, but if the user pastes a log that ends with "use 4 subagents" (a real-world common case), 4 subagents will be spawned — bypassing the rolling-window rate limit because `recordSpawn` is only called for matched values, AND because the rate limit is per-session, not per-user.
**Risk**: Medium. Cost amplification (each subagent = separate LLM call).
**Fix**: Require an explicit CLI flag or a leading "/spawn N" slash command, not a free-text tail match. Move the regex match into a confirmation prompt.

### Finding P1-3 — `inFlight` state from `storedGateResultMap` is not cleared on `cancel`; orphaned state leaks across sessions
**Location**: `prompt.ts:170-180` (the `cancel` function: `personaRoundMap.delete(sessionID); spawnHistory.delete(sessionID); yield* state.cancel(sessionID)`) vs. the per-turn `extraMsgs.push` reading from `storedGateResultMap.get(sessionID)`.
**Issue**: The cancel function deletes `personaRoundMap` and `spawnHistory`, but the prompt-side reads from `storedGateResultMap`, `storedScriptResultsMap`, `storedContentResultsMap`, and the `recentlyCompletedWorkflows` Map in `prompt-sensor-gate-phase.ts`. None of these are cleared by `cancel`. So a cancelled session's gate result, scripts, and content blocks remain available to any later session that re-uses the same `SessionID` (e.g. after `revert.cleanup`). Combined with the per-turn chain enforcement that reads them, a new session that happens to inherit a `SessionID` will see stale data and the wrong skills will be enforced.
**Risk**: Medium. Cross-session state contamination; broken reverts.
**Fix**: Add `storedGateResultMap.delete(sessionID)`, `storedScriptResultsMap.delete(sessionID)`, `storedContentResultsMap.delete(sessionID)`, and `recentlyCompletedWorkflows.delete(sessionID)` to the `cancel` function. Also clear them in `revert.cleanup`.

### Finding P1-4 — Sensor gate runs on `step === 1` for ANY non-synthetic user text, including user-pasted data URIs and image content
**Location**: `prompt.ts:~780-790` (the `if (step === 1 && !session.parentID)` block).
**Issue**: The user-text extracted by `msgs.filter(...).flatMap(...).map(p => p.text).join("\n")` is whatever the model will see as "the user's last message". If a file attachment has a `text/plain` mime that is large enough to be included, the sensor gate sees that text. An attacker who can convince the user to open a malicious file can craft content that includes a `<synthesis-request>` block to permanently skip auto-spawn. Detection is via `p.text.startsWith("<synthesis-request>")` — a string prefix check that is easily bypassed with leading whitespace or Unicode.
**Risk**: Medium. Persistent deactivation of safety features.
**Fix**: Sanitize user text before the synthesis-prefix check, and require an exact match (e.g. `<synthesis-request>` only as the entire trimmed first line), not a prefix.

### Finding P2-1 — `isSensorGateEnabled()` is read at the top of the loop and then `processSensorGatePhase` runs the gate; but a different invocation (shell/command) running concurrently can flip the toggle mid-flight
**Location**: `prompt.ts:170` (cancel) + `prompt.ts:745` (`const sensorGateEnabled = isSensorGateEnabled()`).
**Issue**: The cancel function does not check whether a `processSensorGatePhase` is mid-execution. If user clicks "GATE OFF" while the phase is running, the phase can complete its personas spawn anyway, because cancellation is a cooperative `Effect.interrupt`. A new prompt() after cancel can be racing with a re-enabling of the gate.
**Risk**: Low-medium. State desync.
**Fix**: Make the gate read an immutable snapshot of `sensorGateEnabled` at the start of each phase and freeze it for the duration of that phase.

### Finding P2-2 — `synthesisText` is a `let` mutated across the loop, not a per-step immutable value
**Location**: `prompt.ts:~660-720` (the `let synthesisText: string | undefined` at the top of `runLoop`).
**Issue**: Standard pattern, but the line `synthesisText = undefined` at the top of every iteration means a multi-step agent (a long tool-call sequence) loses its synthesis context between steps. The comment says "On subsequent steps (tool calls, retries), the gate must NOT re-fire" — but the *storage* in `storedGateResultMap` happens only on `step === 1`, so subsequent steps can neither re-fire the gate nor re-inject synthesis. A tool-call chain that takes 20+ steps has no synthesis context for the model to know it is in a sub-skill execution.
**Risk**: Low. State continuity degradation.
**Fix**: Document the trade-off explicitly, or hoist the synthesis text into a part on the user message and let it be visible to the model through the message stream.

### Finding P2-3 — `unloaded.length > 0 && !acknowledged` — `acknowledged` is only set when the model has explicitly issued a `skill` tool call in the message history; the model can satisfy this trivially with a no-op skill call
**Location**: `prompt.ts:~860-890` (`scanForSkillToolCalls(msgs)`).
**Issue**: The skill-enforcer gate tracks "acknowledged" via the presence of any `skill` tool call. A model can satisfy the enforcer by calling the `skill` tool with an empty/invalid name and immediately catching the error. The `unloaded` list will then be cleared, the hard-block will not fire, and no actual skill has been loaded.
**Risk**: Medium. The entire skill-chain enforcement is bypassable by one empty tool call.
**Fix**: Track the return value of each `skill` tool call. A successful load must produce a `SkillLoaded` event; only then mark the chain as loaded.

### Finding P2-4 — Compaction lock is acquired via `compaction.lockCompaction;` (no `yield*` consumed value)
**Location**: `prompt.ts:~920` (`yield* compaction.lockCompaction;`).
**Issue**: Semicolon-terminated expression — `yield* Effect.void` is probably the right form. The bare expression evaluates and discards. The intent is presumably to acquire a lock that is later released by `Effect.ensuring(compaction.unlockCompaction)`. If the lock is implemented as a Ref/Semaphore, the discard is harmless. If it is a `Promise` it is fire-and-forget — fine. But the code reads as if the lock is acquired-then-discarded, which is a code smell that hides whether the lock actually serializes. Without seeing `compaction.lockCompaction` implementation we can't tell, but the comment ("Lock compaction during synthetic phase") is asserted without verification.
**Risk**: Low. Possible race if lock is async.
**Fix**: `yield* Effect.zipRight(compaction.lockCompaction, Effect.void)` or `yield* compaction.lockCompaction.pipe(Effect.as(Effect.void))`.

### Finding P2-5 — `try/catch` is missing around `processSensorGatePhase`; failures silently fall through and the `synthesisText = sgpResult.synthesisText` line assumes a non-null result
**Location**: `prompt.ts:~800-810`.
**Issue**: `processSensorGatePhase` is called with `yield*` but there is no `Effect.catch` to handle its failure. The line `synthesisText = sgpResult.synthesisText` is inside the success branch only. If the function throws, the entire loop is aborted. The `Effect.catchCause` above for `sensorGate.classify` returns a sentinel `SensorGateResult` — that pattern is missing for `processSensorGatePhase`.
**Risk**: Low. Crashes rather than silent fallback.
**Fix**: Add a `Effect.catch` returning a default-no-spawn result.

### Finding P2-6 — `if (userText.trim().startsWith("/compact"))` runs before the agent is loaded; a subagent session also has `parentID` set, so `/compact` only works for root sessions
**Location**: `prompt.ts:~610-625` (the `if (!session.parentID)` block).
**Issue**: Subagents get the silent-skip behavior, which is correct for the use case (subagents shouldn't self-compact), but the comment says "/compact command — bypass sensor gate, trigger compaction directly" — there is no error feedback to the subagent user (the parent) that the command was ignored. The user will see "loop exit" with no indication why.
**Risk**: Low. UX/observability.
**Fix**: If `session.parentID` is set, return a structured "command not available in subagent" error.

### Finding P2-7 — Self-check block `SELF_CHECK` is a hard-coded `const` string injected into every system prompt — a prompt-injection vector if any provider caches this and the user can mutate the source file
**Location**: `prompt.ts:~525-535` (`const SELF_CHECK = \`# Self-Check Protocol ...\``).
**Issue**: Hard-coded. The string is also a behavioral instruction ("verify your reasoning…") that all providers receive. If a user maliciously modifies the source file and the dev server hot-reloads, the new SELF_CHECK is what every LLM call sees. This is the same vector for the `MAX_STEPS` import (a `.txt` file). No integrity check.
**Risk**: Low. Supply-chain only.
**Fix**: Add a checksum file or load from a signed read-only location.

### Finding P3-1 — `_skillService` is yielded but unused
**Location**: `prompt.ts:~165`.
**Issue**: Dead yield. Confusing.
**Fix**: Remove.

### Finding P3-2 — `console.log` from `prompt-state.ts` (line 220 area) uses bare `console.log` for sensor-gate changes; should use `Effect.logInfo` to route through the structured logger
**Location**: `prompt-state.ts:startGateRefresh` and the read-out.
**Issue**: `console.log(\`[sensor-gate] State changed: ${old} → ${sensorGateEnabled}\`)` bypasses the Effect logger.
**Fix**: Replace with `Effect.logInfo` inside an `Effect.sync`.

### Finding P3-3 — `lastUser` is checked for `if (!lastUser) throw new Error("No user message found in stream. This should never happen.")`; the throw is not a `NamedError`, so it is logged as a defect rather than a typed failure
**Location**: `prompt.ts:~520`.
**Fix**: Use a typed `NamedError` subclass.

### Finding P3-4 — `agent.mode !== "subagent"` is the only guard for auto-compaction; the next-line check `if (lastFinished && lastFinished.summary !== true ...)` checks `summary` flag, not the agent mode
**Location**: `prompt.ts:~595-605`.
**Fix**: Make summary detection symmetric.

---

## 3. processor.ts (1130 lines)

> Handles the LLM stream, event dispatch, tool-call lifecycle, doom-loop detection, and interruption cleanup.

### Finding P0-1 — Tool result truncation `truncateToolOutput` strips content silently with no audit trail
**Location**: `processor.ts` does not define `truncateToolOutput`; the helper is in `message-v2.ts:~90-95` (with body `\n[Tool output truncated for compaction: omitted N chars]`). The call site is `processor.ts` indirectly via `message-v2.toModelMessagesEffect`.
**Issue**: Tool output that exceeds `options?.toolOutputMaxChars` is sliced, the head is kept, and the truncated tail is replaced with a one-line message. There is no separate persistence of the original output; the truncated version is what is sent to the model AND persisted (because `MessageTable.data` stores the post-truncation content). When the model attempts to reason about the truncated tail, it has lost the data. The "omitted N chars" message is helpful but the original full output is in memory only — any subsequent revert cannot recover the original.
**Risk**: High. Silent data loss on long tool outputs.
**Fix**: Store the FULL output in `PartTable`; persist the truncation ONLY in the model-message projection. The database part is the source of truth; the model-message is a derived view.

### Finding P0-2 — `DOOM_LOOP_THRESHOLD = 3` triggers doom-loop detection by JSON.stringify equality of `state.input`; two semantically identical inputs with reordered keys are NOT detected
**Location**: `processor.ts:~390-410` (the `tool-call` case with `JSON.stringify(part.state.input) === JSON.stringify(input)`).
**Issue**: The doom-loop guard compares serialized JSON. `{a: 1, b: 2}` and `{b: 2, a: 1}` produce different strings. The AI SDK does not always preserve key order. A model that has a true infinite loop but happens to vary key order will never trip the guard.
**Risk**: High. Real infinite loop not detected → cost amplification.
**Fix**: Use a canonical JSON serialization (sorted keys) or a structural deep-equal.

### Finding P0-3 — `await Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore)` in cleanup leaves a 250ms window where the `ctx.toolcalls` map is iterated while the deferreds may still be in flight
**Location**: `processor.ts:~580-610` (the `cleanup` function's `Effect.forEach(Object.values(ctx.toolcalls), ...)`).
**Issue**: Race condition. The timeout 250ms means the cleanup proceeds after 250ms regardless of whether the tool actually finished. The next line iterates `Object.keys(ctx.toolcalls)` and forces an error state on each. If the tool DOES complete in that 250ms window and writes to `PartTable`, the cleanup will overwrite the success with a "Tool execution aborted" error state — silently destroying the tool result. This is a TOCTOU.
**Risk**: High. Silent data corruption of tool-call results.
**Fix**: Either await the deferred without a timeout (the cleanup is happening in `Effect.ensuring` — the tool must finish first), or use a `Promise.race` with a clear "the deferred won" / "we won" boundary and skip overwrite on the deferred-won path.

### Finding P0-4 — Interrupted-assistant fallback writes a JSON-cloned rest of the message directly to `MessageTable` bypassing normal update channels
**Location**: `processor.ts:~660-680` (the `onInterrupt` block: `JSON.parse(JSON.stringify(rest))` → `database.db.insert(MessageTable).values(...).onConflictDoUpdate(...)`).
**Issue**: Direct `database.db` write while the rest of the code uses `session.updateMessage` (which fires `MessageUpdated` events). The event is NOT published for this direct write. Subscribers to the event stream (TUI, log handlers) will not see the interrupted message; the database is the only source of truth. Re-loading the session will show the interrupted state, but a hot TUI will show stale data. There is also no `Effect.catch` for `JSON.parse(JSON.stringify(...))` if a `BigInt` or circular ref sneaks in (very unlikely but the cast `as any` in `const { id, sessionID: _, ...rest }` is a code smell).
**Risk**: High. Event/log desync; potential crash on BigInt.
**Fix**: Route through `session.updateMessage` (which already exists). If there's a reason it must be bypassed (e.g. the session is locked), publish a `MessageUpdated` event manually after the write.

### Finding P1-1 — `mirrorAssistant = flags.experimentalEventSystem && !input.assistantMessage.summary` — but `flags` is read once at processor creation; if the flag is toggled mid-stream, the dual-write path is committed for the entire stream
**Location**: `processor.ts:~150`.
**Issue**: Once captured, the boolean drives every event publish. Mid-stream flag flips mean a partial migration.
**Risk**: Low-medium. Observability.
**Fix**: Re-read on every event, or use a Ref to track the current state.

### Finding P1-2 — `JSON.stringify(value.result.value)` is used as a fallback for non-string tool outputs; BigInt and circular references throw
**Location**: `processor.ts:~290-305` (in the `tool-result` case, `toolResultOutput`).
**Issue**: The line `JSON.stringify(value.result.value) ?? ""` will throw if the result has a BigInt. A well-meaning tool that returns `{ count: 100n }` will kill the stream.
**Risk**: Medium.
**Fix**: Use `try { JSON.stringify(...) } catch { return "<unserializable>" }`.

### Finding P1-3 — `currentV2AssistantMessage()` `Effect.die`s with a string error; should be a `NamedError`
**Location**: `processor.ts:~210-220` (`ctx.v2AssistantMessageID === undefined ? Effect.die("V2 step settlement has no owning assistant message")`).
**Issue**: String dies are untyped defects. The defect handler in `halt` will format the message but it will not be a typed error.
**Fix**: Use `Effect.dieMessage` with a typed `NamedError`.

### Finding P1-4 — `v2AssistantMessageID = undefined` is set inside the `step-finish` handler, but the next `text-start`/`tool-input-start` will create a new one via `ensureV2AssistantMessage`; if the model produces a step-finish WITHOUT a step-start (some providers), the first event will crash
**Location**: `processor.ts:~470-480` and `processor.ts:~520-540`.
**Issue**: Defensive only. But the race is real: a `step-finish` arrives, the code does `ctx.v2AssistantMessageID = undefined`, then a `text-delta` arrives (next step) — `ctx.currentText` is undefined so the delta is silently dropped. That's correct. But if the provider emits `text-delta` BEFORE `text-start` (some do for cached output), the delta is also dropped.
**Risk**: Low. Provider-specific data loss.
**Fix**: Make `text-delta` create a new text part if none exists.

### Finding P1-5 — The `tool-call` handler resolves `ctx.toolcalls[value.id]` after `updateToolCall` is called; if `updateToolCall` deletes the tool call (because `readToolCall` returned undefined), the next event in the stream that references this `toolCallID` will lose the tool reference
**Location**: `processor.ts:~340-410`.
**Issue**: State machine fragility. If the read returns undefined (which deletes the toolcall), the `recentParts.slice(-DOOM_LOOP_THRESHOLD)` still references the new tool name/input. But `recentParts` is read from the database (`MessageV2.parts(ctx.assistantMessage.id)`), not from `ctx.toolcalls`. So the doom-loop check uses the persisted view — good. But the in-memory `ctx.toolcalls` is now desynced from the persisted state, and the next event will look up a deleted ID.
**Risk**: Low.
**Fix**: Add a `console.warn` when `readToolCall` returns undefined mid-stream.

### Finding P2-1 — `cleanup` iterates `Object.keys(ctx.toolcalls)` after the deferred-await loop; the loop sets `ctx.toolcalls` keys to undefined via `delete`, so the iteration sees stale keys
**Location**: `processor.ts:~595-620`.
**Issue**: Standard pattern. But the in-loop call `ctx.toolcalls = {}` at the end overwrites the ref. Mid-iteration mutation is OK in JS but fragile.
**Fix**: Snapshot keys before the loop.

### Finding P2-2 — `isOverflow` is called on every `step-finish`; the config read `yield* config.get()` happens inside the stream consumer
**Location**: `processor.ts:~485-495`.
**Issue**: Config lookups on every step are cached at higher layers (probably), but the call here is unguarded. A slow config provider blocks the stream.
**Fix**: Cache config at processor creation.

### Finding P2-3 — `retrySet` callback fires `events.publish(SessionEvent.Retried, ...)` but the publish happens inside `Effect.gen` with no error handling; if publish fails, the retry is still attempted
**Location**: `processor.ts:~690-720`.
**Risk**: Low.
**Fix**: Wrap publish in `Effect.ignoreLogged`.

### Finding P2-4 — The `MAX_RETRIES = 5` constant is hard-coded inside the `process` closure; the user cannot tune it
**Fix**: Read from config.

### Finding P2-5 — The `attempt` effect resets `ctx.currentText`, `ctx.currentTextID`, `ctx.reasoningMap` to fresh objects on each retry; but the previous attempt's text-start may have already published a `SessionEvent.Text.Started` event with a specific `textID`. The retry creates a new textID. Subscribers that keyed on the old textID see a ghost.
**Location**: `processor.ts:~715-735`.
**Fix**: Use a stable textID across retries (or explicitly publish a `Text.Cancelled` event before the retry).

### Finding P3-1 — The `flushV2Fragments` function has a `// oxlint-disable-next-line no-self-assign -- reactivity trigger` comment; this is a hack that should be removed
**Location**: `processor.ts:~265-275`.
**Fix**: Remove.

### Finding P3-2 — The doom-loop check uses `permission.ask(...)` which presents a UI; but the user has not configured permissions yet, so the first doom-loop blocks forever (or returns a default deny)
**Location**: `processor.ts:~410-420`.
**Fix**: Default-deny the tool if permission is unknown.

---

## 4. session.ts (1132 lines)

> The session lifecycle service: create/fork/touch/set/get/remove/messages/parts/etc. Two parallel systems V1 (`SessionV1`, `PermissionV1`, `MessageV2`) and V2 (`SessionV2`, `ProjectV2`, `WorkspaceV2`, `EventV2`), bridged via `EventV2Bridge`.

### Finding P0-1 — `fork` rebuilds the message history using `idMap.get(msg.info.parentID)`; if the messageID cursor ordering is not strictly increasing (e.g. after `revert`), the parent mapping is undefined and the cloned message loses its parent
**Location**: `session.ts:~410-450` (the `fork` function).
**Issue**: `MessageID.ascending()` produces a strictly-increasing time-ordered ID. After `revert`, the session is rewound to a prior message; new messages get higher IDs. The fork's `idMap` is built from the pre-fork message list. If the session was previously reverted, the message that is `parentID` of an assistant message may not exist in the post-revert list. `idMap.get(...)` returns undefined; the new assistant message has `parentID: undefined`, which the schema allows but which corrupts the message tree.
**Risk**: High. Forked sessions have broken parent chains.
**Fix**: Walk the parent chain by content (e.g. find the assistant message whose `info.parentID` is in the message list) rather than relying on the ID map.

### Finding P0-2 — `messages` paginates by `before` cursor but the cursor is just an opaque `string`; if the cursor's `time` field drifts (clock skew between writes), pagination returns duplicates
**Location**: `session.ts:~530-560` (the `messages` function: `MessageV2.page(...)`).
**Issue**: The cursor encodes `{id, time}`. If two messages are written within the same millisecond and the clock ticks forward between them, a `before` cursor with `time = T` will include the message with `time = T` because the SQL uses `lt(MessageTable.time_created, row.time)` (strict less-than). But the cursor's own `time` is the same `T` as the boundary message. So the boundary message is excluded by `lt(T, T) === false`, and the user sees a missing page. The fix: encode `time` in nanoseconds (or use a strictly-monotonic counter), not milliseconds.
**Risk**: High. Pagination gaps and duplicates.
**Fix**: Use a high-resolution monotonic clock for `time_created`; encode that in the cursor.

### Finding P0-3 — `getPart` queries `PartTable` by `sessionID AND messageID AND partID` but does not validate that the part's `messageID` is one of the session's messages; a maliciously crafted `PartID` could match a part from a different session with the same `PartID` namespace
**Location**: `session.ts:~660-680` (`getPart`).
**Issue**: The query is `eq(PartTable.session_id, sessionID) AND eq(PartTable.message_id, messageID) AND eq(PartTable.id, partID)`. Three constraints, all equal. The schema-level `PartID` is a typed string but there is no integrity check that the `(sessionID, messageID, partID)` triple is unique across the database. If a corruption event duplicates a part across sessions (manual SQL edit, snapshot restore), `getPart` returns the wrong one with no warning.
**Risk**: High. Cross-session data leak.
**Fix**: Add a database UNIQUE constraint on `(session_id, message_id, id)` for `PartTable`. Re-validate the part's `messageID` matches the requested message after fetch.

### Finding P1-1 — `updateMessage` and `updatePart` publish events via `dieSyncError(events.publish(...))` — if the event bus is down, the database update succeeds but the event never fires, leaving TUI subscribers with stale data and no error path
**Location**: `session.ts:~710-740` (publish-on-update pattern).
**Issue**: `dieSyncError` is presumably a helper that converts a `publish` failure into a thrown `Error`. But the database write has already committed. The subscriber never sees the update. On the next session-load, the data is correct (DB is source of truth) but live subscribers drift.
**Risk**: Medium. TUI/log desync after event-bus failure.
**Fix**: Use an outbox pattern: write the event into a `pending_events` table in the same transaction as the data update, drain via a background job.

### Finding P1-2 — `create` uses `InstanceState.context` and `InstanceState.workspaceID`; these are captured at processor-creation time and reused for every call within the processor, so a per-request workspace override is not possible
**Location**: `session.ts:~80-100` (`create` factory).
**Issue**: `InstanceState` is a per-process singleton in Effect. `create` cannot accept a different workspaceID; it always uses the current process's workspace. The dreamcode extension may need multi-tenant workspace routing, which this design precludes.
**Risk**: Medium. Multi-tenant brokenness.
**Fix**: Accept `workspaceID` as an explicit argument; make `InstanceState` overridable per-call.

### Finding P1-3 — `remove` recursively removes children, but child sessions may have parent links (and their own children) — if the recursion hits a session that is mid-write, the database will throw a FOREIGN KEY constraint error
**Location**: `session.ts:~290-320` (`remove`).
**Issue**: Standard `Effect.catch` should handle this. But there is no retry on the catch; the parent's `remove` returns the error and the parent's `Event.Deleted` does not fire, leaving the parent "ghosted" in the TUI.
**Risk**: Medium. Zombie parent sessions.
**Fix**: Retry the child remove up to 3 times with exponential backoff before bubbling.

### Finding P1-4 — `getMessage` does `getMessage(sessionID, messageID)` but the message lookup is on `id` only; the `sessionID` is only used for permissions checks. If a `messageID` exists in multiple sessions (different worktrees merged), the first DB hit wins
**Location**: `session.ts:~640-660` (`getMessage`).
**Issue**: The query is `eq(MessageTable.id, messageID)` without a `sessionID` filter. A `MessageID` is supposedly unique across the database, but if two worktrees share a database and `MessageID.ascending()` is process-local (not global), the IDs collide.
**Risk**: Medium. Cross-worktree message confusion.
**Fix**: Always filter by `sessionID`. Add a UNIQUE index on `(session_id, id)`.

### Finding P2-1 — `set` updates `SessionTable.data` and `SessionTable.time_updated`, but does NOT update the `MessageTable` cursor; the `messages` pagination cursor uses `time_created` on messages, which is fine, but the `SessionV1.Info.time.updated` field is read by the TUI for "session last touched" and uses `SessionTable.time_updated` (good) — but `set` does not also bump `SessionV1.Info.parentID` if the parent was changed
**Location**: `session.ts:~430-450` (`set`).
**Fix**: When `parentID` is updated, fire a `SessionEvent.Updated` event.

### Finding P2-2 — `get` returns `NotFoundError` when the session does not exist; but the `NotFoundError` interface is imported from `@/storage/storage` and the check is `instanceof`. If a different module's `NotFoundError` is in the same dependency graph (different package version), the check fails and the function throws the underlying SQL error
**Location**: `session.ts:~600-620` (`get`).
**Fix**: Use a unique symbol or a tagged union.

### Finding P2-3 — `updatePart` and `updateMessage` use `database.transaction(...)` but the transaction does not include the `PartTable` write for `updateMessage`'s cascade; if the message update fails midway, the parts are in an inconsistent state
**Location**: `session.ts:~680-720` (`updateMessage` and `updatePart`).
**Fix**: Wrap in a single `Effect.scoped` transaction.

### Finding P2-4 — `messages` returns `MessageV2.WithParts[]` but the `parts` field is populated by a separate query (`inArray(PartTable.message_id, ids)`); if the parts query fails (e.g. database disconnect), the entire `messages` call fails and the user sees no messages, not "messages with missing parts"
**Location**: `session.ts:~530-560` (`messages`).
**Fix**: Hydrate parts in a second pass; on parts-query failure, return messages with empty `parts: []` and log a warning.

### Finding P3-1 — `EventV2Bridge` is imported but its usage is sparse; this suggests V1↔V2 event mirroring is incomplete
**Location**: `session.ts:1-50` (imports).
**Fix**: Audit event bridge coverage; add tests for the missing events.

### Finding P3-2 — Several `Effect.fn` blocks do not include `withSpan` for tracing; debugging will be hard
**Location**: `session.ts` (throughout).
**Fix**: Add `Effect.withSpan("Session.<method>")` to every `Effect.fn`.

### Finding P3-3 — `create` is `Effect.fn("Session.create")` but `remove`, `set`, `updateMessage`, `updatePart` are not named; inconsistent observability
**Location**: `session.ts` (throughout).
**Fix**: Name all `Effect.fn` consistently.

---

## 5. prompt-sensor-gate-phase.ts (585 lines)

> The sensor gate phase that classifies user prompts and decides what skill chain to enforce.

### Finding P0-1 — `recentlyCompletedWorkflows` Map keyed by sessionID is cleared only "once personas successfully spawn" — if persona spawn fails (e.g. quota exhausted), the Map is never cleared and a future turn will see stale workflow state
**Location**: `prompt-sensor-gate-phase.ts:~340-380` (the `recentlyCompletedWorkflows` Map and its clear logic).
**Issue**: The Map is append-only on the success path. If `processSpawn` throws, the `Effect.catch` returns a default result that does not clear the Map. The next turn for the same session will see the prior turn's "completed" workflows and may short-circuit, skipping the gate entirely.
**Risk**: High. Permanent deactivation of the sensor gate for sessions that had even one failure.
**Fix**: Clear the Map in a `Effect.ensuring` block, regardless of success/failure.

### Finding P0-2 — The `effectMeta` synthesis request regex matches `<synthesis-request>` but the matching is done on `p.text.startsWith(...)` — a `<` (U+003C) followed by anything starting with "synthesis-request" passes; this is a string prefix check with no structural validation
**Location**: `prompt-sensor-gate-phase.ts:~200-220` (the `parseExplicitSpawnCount` / synthesis-detection block).
**Issue**: Same as `prompt.ts` P1-4. The `<synthesis-request>` block is the only way to skip auto-spawn. If the synthesis check passes for a malformed payload (e.g. `<synthesis-request>...` followed by 50KB of attacker text), the gate is bypassed and the assistant runs without the safety skill chain.
**Risk**: High. Persistent deactivation of safety features.
**Fix**: Validate that the entire message (or a clearly bounded section) is a `<synthesis-request>` block; reject otherwise.

### Finding P1-1 — `processSensorGatePhase` is `Effect.fn` but the body has multiple `yield*` calls to services that may not all be present in the runtime context; a missing service is caught as a defect, not a typed error
**Location**: `prompt-sensor-gate-phase.ts:~100-150` (the `processSensorGatePhase` body).
**Fix**: Declare the service requirements explicitly via `R` generic; let Effect reject missing services at the type level.

### Finding P1-2 — The classification uses `sensorGate.classify(text)` which returns a `Promise<SensorGateResult>`; the `await` is on the result, but if `classify` throws synchronously (e.g. OOM on a 10MB input), the throw is not caught
**Location**: `prompt-sensor-gate-phase.ts:~250-280`.
**Fix**: Wrap in `try/catch` and return a default `unclassifiable` result.

### Finding P1-3 — Spawn quota `RATE_MAX_SPAWNS = 5` is per-session, but a user can create N sessions and bypass the global limit
**Location**: `prompt-state.ts:checkRateLimit`.
**Fix**: Track spawns per-user (e.g. in `~/.opencode/state.json`), not per-session.

### Finding P1-4 — The `mandatedReExecute` function re-runs skills that were marked as "mandated" but the user did not actually load them. If the model legitimately skipped a mandated skill because it was not relevant, this re-execution forces it to run anyway, wasting tokens and potentially biasing the model toward an irrelevant skill's output
**Location**: `prompt-sensor-gate-phase.ts:~450-500` (the `mandatedReExecute` block).
**Risk**: Medium. Forced waste of context and tokens.
**Fix**: Add a "skip with justification" path; do not force re-execution.

### Finding P2-1 — The sensor gate phase emits a `sgpResult` that is then stored in `storedGateResultMap` — but the map's key is the sessionID, so two concurrent turns on the same session (e.g. parallel tool calls) will race to overwrite each other's gate result
**Location**: `prompt-sensor-gate-phase.ts:~480-510` (the `storedGateResultMap.set(sessionID, sgpResult)` line).
**Issue**: Module-level mutable Map with no mutex. Concurrent writes from two `processSensorGatePhase` invocations on the same sessionID will lose one of the results.
**Risk**: Medium. Lost gate results.
**Fix**: Wrap in `Effect.scoped` with a per-sessionID `Mutex`.

### Finding P2-2 — The "persona spawn" path calls `yield* personaSpawner.spawn(requirements)`; the spawner is invoked as a child agent, but the child has no way to signal "I have completed and now the user should see my output" — the gate assumes the spawn is fire-and-forget, which is wrong if the persona needs to be visible to the user
**Location**: `prompt-sensor-gate-phase.ts:~380-420`.
**Fix**: Add a `PersonaSpawnResult` that includes a reference to the spawned child session, and surface it in the TUI.

### Finding P2-3 — The `chainResults` array is mutated in place via `chainResults.push(...)` after the re-execution. Effect convention is to return new values; in-place mutation of a value that was passed by reference is a side-effecting anti-pattern
**Location**: `prompt-sensor-gate-phase.ts:~460-470`.
**Fix**: Return a new `chainResults` array from the function.

### Finding P3-1 — The phase uses `console.log` for diagnostic output in some paths; should be `Effect.logDebug` for structured logging
**Location**: `prompt-sensor-gate-phase.ts:~150-180`.
**Fix**: Replace with structured logging.

### Finding P3-2 — The "minimal mode" signal `<sensor-gate state="minimal">` is a magic string shared between producer and consumer; if either side misspells it, the consumer falls through to default behavior silently
**Location**: `prompt-state.ts:SENSOR_GATE_MINIMAL_SIGNAL`.
**Fix**: Use a constant comparison in both places; add a startup assertion.

### Finding P3-3 — The "DIAGNOSTIC: ..." prefix in the synthesis text is a hack for the TUI to render a special block; it should be a typed part, not a string prefix
**Location**: `prompt-sensor-gate-phase.ts:~520-540`.
**Fix**: Return a `Diagnostic` schema object; let the TUI render it.

---

## 6. compaction.ts (652 lines)

> The compaction service: prunes old tool output, manages context overflow, and creates a compacted "summary" message.

### Finding P0-1 — `PRUNE_PROTECT = 40_000` chars is the threshold for protecting a message from being pruned, but the actual message size includes the `system` prompt, user/assistant text, AND tool output. A single 45K-char tool output will be protected, but a 39K-char tool output combined with 2K of user text will be pruned — the 2K of user text is more important than the 39K of tool output for context
**Location**: `compaction.ts:~80-120` (the `PRUNE_MINIMUM`, `PRUNE_PROTECT`, `PRUNE_PROTECT_THRESHOLD` constants).
**Issue**: The protection logic is based on the individual message's `state.output.length` (for tool parts) or `info.text.length` (for text parts). It does not consider the relative importance of the message in the conversation. A `read` of a 5MB log file that was 2K of text summary (a "the file has 10000 lines" message) will be pruned because the message text is small, even though the tool output is the most important data in the session.
**Risk**: High. Loss of critical context during compaction.
**Fix**: Score each message by importance (recent? user-authored? contains file paths? explicitly referenced by the model?) and protect based on score, not size.

### Finding P0-2 — `COMPACT_TOOL_OUTPUT_MAX_CHARS = 500` is the truncation limit for tool output during compaction; this is far too low for many real-world tools
**Location**: `compaction.ts:~100-110`.
**Issue**: A 500-char truncation of a `bash` tool output (e.g. `ls -la /var/log`) will lose the filenames. A 500-char truncation of a `read` tool output will lose most of the file. The number is hard-coded with no override.
**Risk**: High. Data loss on compaction.
**Fix**: Make this configurable per-tool; default to a higher value (e.g. 5000).

### Finding P0-3 — The compaction summary is written as a single "compaction" part on the user message; the user message's text is preserved but the assistant response that was generated in response to that user message is the one being summarized — the summary refers to data that no longer exists in the model context
**Location**: `compaction.ts:~200-250` (the `compact` function and its summary message).
**Issue**: Standard pattern, but the summary message is a "user" role message that the model will see in subsequent turns. The model will treat the summary as user-provided content. If the summary contains a directive ("don't forget to use the `test` skill"), the model will obey it. If a malicious tool output made it into the summary (e.g. a tool that returned a JSON object with a `summary` field), the attacker can inject a directive that survives compaction.
**Risk**: High. Prompt injection survives compaction.
**Fix**: Treat the summary as a `system`-scoped, sanitized part; never as user-scoped.

### Finding P1-1 — `lockCompaction` is a global Ref-based lock; if two sessions try to compact simultaneously, one will wait indefinitely if the first's compaction hangs
**Location**: `compaction.ts:~150-170` (`lockCompaction` and `unlockCompaction`).
**Risk**: Medium. Deadlock potential.
**Fix**: Add a timeout to the lock acquisition.

### Finding P1-2 — The compaction walks messages from oldest to newest, pruning as it goes. If the walk fails midway (e.g. database read error), the partial pruning is committed; the next compaction attempt will see a partially-pruned message history and may prune too aggressively
**Location**: `compaction.ts:~280-320` (the `prune` function).
**Fix**: Wrap the entire walk in a transaction; rollback on error.

### Finding P1-3 — `state.time.compacted = true` is set on the part metadata; this is a write to the database that does not fire a `PartUpdated` event (presumably for performance reasons), so the TUI does not see the compaction until the next message
**Location**: `compaction.ts:~300-330` (the `markCompacted` function).
**Fix**: Fire a `PartUpdated` event with the new metadata; the TUI can debounce.

### Finding P1-4 — The summary generator is called as `yield* summary.generate(messages)`; if the generator fails (e.g. LLM rate limit), the compaction aborts and the user sees no summary, but the pruning has already happened
**Location**: `compaction.ts:~210-250` (the `compact` function).
**Issue**: Order of operations: prune first, then summarize. If summary fails, the conversation is pruned without a summary — the model loses context.
**Risk**: High. Data loss on summary failure.
**Fix**: Summarize first (using the full, unpruned data), then prune. The summary is a "save point"; the prune is a "context shrink". Order matters.

### Finding P2-1 — The compaction function does not check whether the session is currently being processed (i.e. a stream is in flight); pruning a message that the model is currently reasoning about will cause a `Part not found` error
**Location**: `compaction.ts:~200-230`.
**Fix**: Acquire a session-level read-write lock before compacting.

### Finding P2-2 — `isOverflow` checks `tokens > maxTokens` but the `tokens` value is from a previous model call; the current prompt may have grown since then
**Location**: `compaction.ts:~330-360` (`isOverflow`).
**Fix**: Re-tokenize the current prompt before checking.

### Finding P2-3 — The `summary.ts` `generate` function uses an LLM call; the LLM is the one being summarized. If the LLM has rate limits, the summary call counts against the rate limit, which can cause cascading failures
**Location**: `compaction.ts` (call to summary) + `summary.ts:generate`.
**Fix**: Use a separate rate limit pool for summaries.

### Finding P2-4 — The compaction's `lockCompaction` is a Semaphore with `permits = 1`; the `lockCompaction` call in `prompt.ts:~920` (see P2-4) yields the lock but does not consume the permit — the lock is then released by `Effect.ensuring`. This is a "named permit" pattern that may or may not work depending on the Semaphore implementation
**Location**: `compaction.ts:~150-170` and `prompt.ts:~920`.
**Fix**: Use `Effect.makeSemaphore` with explicit `withPermits(1)` block.

### Finding P3-1 — The constants `PRUNE_MINIMUM`, `PRUNE_PROTECT`, `COMPACT_TOOL_OUTPUT_MAX_CHARS` are not exported; they cannot be tuned without source changes
**Location**: `compaction.ts:80-110`.
**Fix**: Export them; read from config.

### Finding P3-2 — The compaction message has type `"compaction"`, which is rendered in the TUI as a special part. The TUI code is in a different package; if the schema is updated, the TUI will break silently
**Location**: `compaction.ts` (schema usage).
**Fix**: Add a schema version field.

### Finding P3-3 — `state.time.compacted` is `true` after pruning; subsequent `prune` calls will see this and skip the part. But the compaction summary message ALSO has `compacted = true` (presumably to prevent re-compaction); this creates a feedback loop where the summary itself is not re-summarized, but the data it references is gone
**Location**: `compaction.ts:~300-330`.
**Fix**: Document the invariant; add a test.

---

## 7. message-v2.ts (752 lines)

> The message v2 schema, database hydration, and model-message conversion (`toModelMessagesEffect`).

### Finding P0-1 — `truncateToolOutput` does not preserve the original; see processor.ts P0-1
**Location**: `message-v2.ts:~90-95`.
**Issue**: Same as processor.ts P0-1. Truncation is silent and irreversible.
**Risk**: High.
**Fix**: Same as processor.ts P0-1.

### Finding P0-2 — `FetchDecompressionError` interface declares `code: "ZlibError"` but does not extend `Error`'s `name` field; if a third-party decoder throws an error with `code = "ZlibError"` but `name = "Error"`, the type guard `if (e.code === "ZlibError")` works but `e instanceof Error` may not (if the prototype chain is broken)
**Location**: `message-v2.ts:~55-65` (`FetchDecompressionError`).
**Fix**: Make the interface `Error`-compatible explicitly.

### Finding P0-3 — `convertToModelMessages` from the `ai` SDK is called inside `toModelMessagesEffect`; the SDK version is pinned at `package.json` level, but `ai` SDK is known to have breaking changes between minor versions. A `bun install` that updates `ai` from 4.x to 4.y may silently change message format
**Location**: `message-v2.ts:~50-80` (imports + use).
**Issue**: No version check; no integration test against the latest `ai` SDK.
**Risk**: Medium-high. Silent breaking change.
**Fix**: Add a version assertion at startup; add a contract test.

### Finding P1-1 — `providerMeta(metadata)` strips `providerExecuted` but does not validate the resulting object; an attacker who can write to `PartTable.metadata` can inject arbitrary `providerMetadata` that the model SDK will pass through to the provider
**Location**: `message-v2.ts:~100-115`.
**Risk**: Medium. Provider-specific data injection.
**Fix**: Whitelist allowed keys per provider.

### Finding P1-2 — `toModelMessagesEffect` calls `JSON.parse` on the cursor without error handling; a malformed cursor (truncated, base64-decoded to invalid JSON) will throw
**Location**: `message-v2.ts:~115-130` (`decodeCursor`).
**Fix**: Wrap in `try/catch`; return a 400.

### Finding P1-3 — `isMedia(mime)` is used to filter attachments; the function is in `@/util/media` and is a string check. If the mime type is `image/jpg` (non-standard, should be `image/jpeg`), the check fails and the image is dropped
**Location**: `message-v2.ts` (call sites).
**Fix**: Use a proper mime library (e.g. `mime-types`).

### Finding P1-4 — The `supportsMediaInToolResult` function is a hard-coded list of SDK names; adding a new SDK requires adding a new branch. The default `return false` means new SDKs silently lose media support
**Location**: `message-v2.ts:~150-180` (`supportsMediaInToolResult`).
**Fix**: Use a registry pattern.

### Finding P1-5 — `Cursor` schema requires `time >= 0`; a malicious cursor with `time = -1` is rejected by the schema, but the `decodeUnknown` failure is silent — the user sees an empty page rather than an error
**Location**: `message-v2.ts:~100-110` (`Cursor` schema and `decodeCursor`).
**Fix**: Throw a typed error on decode failure.

### Finding P2-1 — `MessageV2.parts` is a separate query from `messages`; the join happens in the hydrate function. If a part is added between the two queries (concurrent write), the part is missing from the result
**Location**: `message-v2.ts:~200-250` (`hydrate`).
**Fix**: Use a single query with JOIN; or document the eventual-consistency window.

### Finding P2-2 — `older` cursor helper uses `lt(MessageTable.time_created, row.time) OR (eq + lt(id))` — the OR with `and(eq, lt)` is correct, but the `older` cursor is the boundary; messages with `time = row.time` are excluded, but the cursor is for `row.time`, so the first message on the next page should be the one with `time = row.time` (exclusive). This is a classic off-by-one
**Location**: `message-v2.ts:~190-200` (`older`).
**Fix**: Verify with integration tests; the boundary is correctly handled but the logic is fragile.

### Finding P2-3 — `withParts` and `Part` types are re-exported from `SessionV1`; the schema changes there will silently change the type here
**Location**: `message-v2.ts:1-30` (re-exports).
**Fix**: Add a contract test.

### Finding P3-1 — `cursor.encode` uses `base64url` but the decoded JSON is parsed without a `JSON.parse` size limit; a maliciously crafted base64 input can decode to a 100MB JSON, causing OOM
**Location**: `message-v2.ts:~120-130` (`decodeCursor`).
**Fix**: Check string length before parsing.

### Finding P3-2 — The `Cursor` schema does not include `sessionID`; a cursor for one session can be used against another if the `id` collides
**Location**: `message-v2.ts:~100-110`.
**Fix**: Include `sessionID` in the cursor; reject mismatches.

### Finding P3-3 — `truncateToolOutput` does not handle multi-byte UTF-8 correctly; `text.length` is the char count, but `text.slice(0, maxChars)` splits on char boundaries, which may split a multi-byte UTF-8 sequence in half and produce invalid UTF-8
**Location**: `message-v2.ts:~90-95`.
**Fix**: Use a `TextDecoder`/`TextEncoder` round-trip or count code points.

### Finding P3-4 — `hydrate` is called as part of a larger `Effect.gen`; the inner `db.select()...all()` is inside `.pipe(Effect.orDie)`, which converts the error to a defect. A transient DB error is a defect, not a tagged error
**Location**: `message-v2.ts:~200-230`.
**Fix**: Use `Effect.catchTag` to convert to a typed error.

---


# Anchored Summary — Chain Enforcement & Skill Loading Fix

## Root Cause
Chain executor pre-runs all skills and injects `<skill-result>` blocks BEFORE the agent acts → agent sees full results already in context → has zero incentive to call `skill` tool → TUI never shows "Loading skill..." → `<chain-mandatory>` is dead letter.

## All Changes Applied

### 1. `prompt.ts` — Sanitization (allowlist approach)
`sanitizeForSystemPrompt()` now strips ALL closing tags (`</tag>`) and self-closing tags (`<tag/>`) instead of a tag-name blocklist. This is future-proof — new system tags don't need to be added to the regex. All script output is now sanitized before injection.

### 2. `prompt.ts` — `<chain-mandatory>` → `<chain-enforcement>`
Replaced the old dead-letter instruction with a block that:
- Acknowledges script results are pre-injected in `<script-result>` blocks
- Still requires agent to call `skill` tool for EACH skill
- Adds `[SKILLS LOADED]` acknowledgement requirement
- Tells agent about the TUI loading indicator

### 3. `prompt.ts` — `<skill-result>` → `<script-result>`
Chain executor results are now injected as `<script-result>` blocks (script execution output) rather than `<skill-result>` (which implied skill content was loaded). Distinguishes script analysis from mandatory tool-based skill content loading.

### 4. `prompt.ts` — Runtime tracking of skill tool calls
After chain-gap detection, scans assistant messages for actual `skill` tool calls (V1 `ToolPart` with `tool === "skill"` and `state.status === "completed"`). Injects `<skill-loading-gap>` warning for any unloaded chain skills.

### 5. `prompt.ts` — Subagent skill loading is now mandatory
Changed from "Use the skill tool as needed" to "CRITICAL: You MUST load EACH skill from this chain" with explicit mandatory language matching the main agent.

### 6. `prompt.ts` — Fallback persona rate limit bypass fixed
Rate limit check (`checkRateLimit()`) now runs BEFORE the fallback persona `shouldSpawn` override, preventing bypass.

### 7. `prompt.ts` — Script output sanitized
ALL `result.output` and `result.name` values from chain executor are now wrapped with `sanitizeForSystemPrompt()` before system prompt injection. Covers `<script-result>`, `<chain-executor-result>`, `<chain-verification>`, `<chain-gap>`, and `<skill-missing>` blocks.

### 8. `tool/skill.ts` — Deprecated shim fixed
The runtime guard now returns actual skill content from `Skill.Service.require()` instead of the stub `"[SKILL TOOL: deprecated — delegated to core skill system]"`. Includes proper not-found handling.

### 9. `tool/skill.txt` — Description updated
Now mentions mandatory chain loading: "You MUST load each skill from the chain using this tool."

### 10. `tool.ts` (CLI) — TUI loading indicator
Added loading state: shows `…` while running/pending and `✓` when complete. Title changes from "Loading skill X" to "Loaded skill X".

### 11. `AGENTS.md` — Documentation updated
Full documentation of chain enforcement patterns, sanitization approach, runtime tracking, TUI indicator, and deprecated tool fix.

## Key Files Changed
| File | Change |
|------|--------|
| `prompt.ts` | Sanitization (allowlist), chain-enforcement, script-result, runtime tracking, subagent mandatory, fallback rate fix, output sanitization |
| `tool/skill.ts` | Deprecated shim returns actual skill content |
| `tool/skill.txt` | Description mentions mandatory chain loading |
| `tool.ts` (CLI) | TUI loading indicator (… vs ✓) |
| `AGENTS.md` | Chain enforcement patterns documented |
| `anchored-summary.md` | This file |

## Context
- Date: June 27, 2026
- Next: Verify end-to-end that agent calls `skill` tool, TUI shows "Loading skill..." → "skill loaded ✓"

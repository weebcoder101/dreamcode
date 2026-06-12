---
name: automated-learning
description: "Self-evolution skill — captures what worked, what failed, and what to change after every non-trivial run. Produces routing patches, registry hygiene checks, and paste-ready Learning Notes for run_log.jsonl. Mandatory post-run step for STANDARD, DEEP, and DREAM_INNOVATION modes."
chains_with: []
---

# Automated Learning — Self-Evolution Engine

## Purpose

Make the agentic harness improve itself continuously without manual prompting. After every non-trivial task, this skill captures learning signals, produces routing patches, and emits paste-ready artifacts for the evolution log.

## When to Trigger

- After any STANDARD, DEEP, or DREAM_INNOVATION execution completes
- After any routing error (wrong skill selected, missing skill, name mismatch)
- After any verification failure (tests/lint/constraints not met)
- After any YAML frontmatter parse failure is suspected

## Mandatory Steps (no skipping)

### Step 1: Capture Signal

Extract exactly 3 bullet points:
- **What worked**: the tool, search, or pattern that succeeded
- **What failed**: the tool, search, or pattern that broke
- **What to change**: the specific rule, mapping, or constraint to adjust

### Step 2: Produce Routing Patch

A routing patch is plain English with exactly 3 items:
1. **Rule to ADD**: one new routing rule (e.g., "If user says 'git-workflow', map to canonical id `git`")
2. **Rule to REMOVE or WEAKEN**: one existing rule that caused a failure
3. **Alias mapping to introduce**: one new alias (e.g., `"hardener" → "code-hardener"`)

### Step 3: Skill Registry Hygiene Checklist

Verify and report:
- [ ] All YAML frontmatter `description` strings are quoted (avoid `:` and `—` parse failures)
- [ ] Skill `name` field in YAML matches the directory name exactly
- [ ] Registry entry maps alias to canonical id
- [ ] No orphan directories exist (directories without SKILL.md)

### Step 4: Emit Learning Note

Output a section titled `Learning Note (paste into run_log.jsonl)` containing a single JSON object as text.

#### Output Format (Standardized run_log Schema)

```json
{
  "timestamp_utc": "<ISO 8601 UTC>",
  "prompt_excerpt": "<first 120 chars of user prompt>",
  "chain": ["<skills in execution order>"],
  "chain_length": <int>,
  "selected_skills": ["<primary>", "<support1>", "<support2>"],
  "outcome": "success | failed | partial",
  "mistake": "<what went wrong, or 'none' if clean>",
  "fix_rule": "<the routing patch rule to add>",
  "neuro_was_available": true | false,
  "ltm_was_available": true | false,
  "lint_exit_clean": true | false | null,
  "files_changed": ["<path1>", "<path2>"],
  "pieces_written": true | false,
  "key_decisions": ["<decision1>", "<decision2>"],
  "registry_hygiene": {
    "yaml_quoted": true,
    "name_directory_match": true,
    "no_orphans": true
  },
  "notes": "<free text>"
}
```

**Note:** The field `timestamp_utc` is canonical. `timestamp_local` is deprecated. All existing entries in `run_log.jsonl` with legacy fields should be converted on write. The `pieces_written` field MUST be verified against `evolution/pieces_writes.jsonl` to ensure actual persistence occurred.

## Integration with Self-Evolution Mandate

This skill feeds into the AGENTS.md Section 10 (Self-Evolution Mandate). The Learning Note produced here is the artifact that gets appended to `.opencode/skills/exhaustive-crosscheck/evolution/run_log.jsonl`.

## Failure Modes

| Failure | Action |
|---------|--------|
| Can't identify what failed | Set `mistake: "unidentified"` and note the ambiguity |
| YAML parse failure suspected | Flag it in `registry_hygiene.yaml_quoted: false` |
| Skill name mismatch detected | Include the mismatch in `fix_rule` |
| No errors occurred | Set `mistake: "none"` and emit a positive routing confirmation |

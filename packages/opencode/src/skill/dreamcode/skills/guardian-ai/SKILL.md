---
name: guardian-ai
description: "Codex-inspired Guardian AI — NEURO-powered safety supervisor that reviews agent actions on EVERY prompt before execution. Uses NEURO API as its brain. Validates code changes, catches security issues, prevents destructive operations. MANDATORY — cannot be skipped."
category: META
chains_with: ["neuro", "code-hardener", "security"]
---

# Guardian AI — NEURO-Powered Safety Supervisor

**Inspired by:** OpenAI Codex's Guardian AI pattern.
**Powered by:** NEURO API (neurometric/clawpack model).
**Purpose:** Reviews every prompt for safety BEFORE any work begins.

---

## Architecture

```
User Prompt
    ↓
SENSOR GATE (Stage 0-2) — classify intent, select skills
    ↓
GUARDIAN AI (via NEURO API) — safety review ← CANNOT BE SKIPPED
    ↓
  ├─ APPROVED → proceed to skill chain
  ├─ REJECTED → STOP, report to user
  └─ HUMAN_REQUIRED → ask user, wait for approval
    ↓
SKILL CHAIN (Stage 4) — execute selected skills
    ↓
Response
```

---

## How It Works

### 1. Hard-Block Check (instant, no API)
Patterns that are instantly rejected without NEURO:
- `rm -rf /` — root filesystem delete
- `DROP TABLE` — database destruction
- `git push --force main` — force push to main
- `sudo rm` — superuser delete

### 2. Safe Pattern Check (instant, no API)
Patterns that are instantly approved:
- `pytest` — run tests
- `ruff check` — lint
- `mypy` — type check
- `git status` — check status

### 3. NEURO API Review (the brain)
For everything else, NEURO evaluates:
- Destructive operations
- Security risks (auth, secrets, credentials)
- Data loss risk
- Architecture violations
- Convention compliance

---

## Usage

```bash
# Via sensor gate (automatic on every prompt)
python .opencode/skills/chain-orchestrator/scripts/sensor_gate.py --prompt "Fix the bug"

# Direct call
python .opencode/skills/guardian-ai/scripts/guardian_ai.py --prompt "delete all users table"

# JSON output
python .opencode/skills/guardian-ai/scripts/guardian_ai.py --prompt "add rate limiting" --json
```

---

## Risk Levels

| Level | Auto-Approve? | Example |
|-------|---------------|---------|
| `low` | Yes | Lint fix, comment update, import reorder |
| `medium` | Yes (with logging) | Feature addition, refactor, test addition |
| `high` | No → Human required | Auth changes, data contract changes, CI config |
| `critical` | No → Human required | Secret handling, destructive ops, prod deployment |

---

## Output Format

```
[GUARDIAN] Safety Review
- decision: APPROVED | REJECTED | HUMAN_REQUIRED
- risk_level: low | medium | high | critical
- source: neuro | rule_based | hard_block | safe_pattern
- reason: <1-2 sentence explanation>
```

---

## Integration with Skill Chain

```
exhaustive-crosscheck → neuro → guardian-ai → code-hardener → implementation → lint-fixer
```

Guardian AI runs **before** code-hardener, acting as a pre-flight safety check.

---

## Configuration

In `.opencode/config/opencode.yaml`:

```yaml
guardian_ai:
  enabled: true
  review_before_apply: true
  max_auto_approve_risk: "low"
  require_human_approval:
    - "high"
    - "critical"
```

---

## Logging

All Guardian AI decisions are logged to `evolution/guardian_ai.jsonl`:
```json
{
  "timestamp": "2026-06-11T16:00:00Z",
  "prompt_excerpt": "fix the login bug",
  "decision": "APPROVED",
  "risk_level": "medium",
  "reason": "Bug fix, non-destructive",
  "source": "neuro"
}
```

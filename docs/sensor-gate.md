# Sensor Gate — Intent Classification & Chain Selection

The Sensor Gate is DreamCode's first-stage classification system. It runs on every user turn (before the LLM) to determine intent, select skills, and decide whether to spawn specialist agents.

## How It Works

```
User Prompt
    ↓
Sensor Gate (Python)
  ├─ Intent classification
  ├─ Domain tagging
  ├─ Risk assessment
  ├─ Skill chain selection
  └─ Specialist spawn decision
    ↓
Guardian AI (risk approval)
    ↓
LLM + Skill Chain Execution
```

## Gate Output

The sensor gate Python script produces a structured JSON result:

```json
{
  "intent": "Fix authentication bug in login flow",
  "domain_tags": ["security", "backend", "api"],
  "risk_level": "medium",
  "confidence": 0.85,
  "complexity": "medium",
  "primary_skill": "debugging",
  "support_skills": ["testing", "security"],
  "chain": ["debugging", "testing", "security"],
  "guardian_decision": "APPROVED",
  "guardian_risk": "low",
  "mode": "DREAM_INNOVATION",
  "personas": [
    {"name": "The Detective", "role": "Root Cause Analysis", ...},
    {"name": "The Artisan", "role": "Code Quality", ...}
  ]
}
```

## Spawn Decision

The spawn necessity algorithm (`evaluateSpawnNecessity()`) determines if specialists are needed:

| Factor | Weight | Condition |
|--------|--------|-----------|
| Simplicity pattern | Skip | Prompt starts with `fix/update/change/add/remove` |
| Unique domains | +3 | 3+ different domain tags |
| Unique domains | +1 | 2 different domain tags |
| High risk | +2 | `risk_level === "high"` |
| Chain length | +2-3 | `effectiveChainLen >= 2` (filtering "always" skills) |
| DREAM_INNOVATION | +2 | Innovation mode active |
| Code + long prompt | +1 | Code blocks present and prompt > 200 chars |

**Score → Spawns**: `ceil(score / 2)`, capped at 5.

## Rate Limiting

- **5 spawns per 5-minute rolling window** per session
- Enforced in code, not just prompt text
- When limit hit: rate-limit warning injected, task handled directly

## Bypass

The sensor gate is bypassed for:
- **Subagent sessions** (they don't re-enter persona spawning)
- **Synthesis responses** (synthetic messages don't re-trigger classification)
- **`/compact` commands** (directly trigger context compaction)
- **Greeting detection** (`is_social_greeting: true` skips chain execution)

## Configuration

`~/.config/dreamcode/config.yaml`:
```yaml
sensor_gate:
  enabled: true
  min_confidence: 0.5
  max_personas: 5
```

## Related

- [Dream Thinking](dream-thinking.md) — The 6-phase engine activated by sensor gate
- [Skills Reference](skills.md) — Skills selected by sensor gate
- [Scoring & Enforcement](scoring.md) — Scoring after execution

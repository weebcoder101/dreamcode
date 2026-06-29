---
name: token-predictor
description: "Shipping checklist question generator with dedup, NEURO enrichment, and circuit breaker safety. Generates unique developer-focused questions about shipping readiness."
---

# Token Predictor — Shipping Checklist Generator

Generates unique developer-focused questions about shipping readiness.

## Features

- Heuristic question generation from project context (15 signal categories)
- Dedup via JSONL log with SHA-256 hash matching (max 500 entries)
- NEURO enrichment when API key available
- Circuit breaker for execution safety (3 failures → 5min cooldown)
- Auto-regeneration on duplicate detection (max 5 retries)

## Integration

This skill is integrated into the plugin system via `SensorGateEnforcerPlugin`:
- Hooks into `chat.message` for 45s periodic timer check
- Hooks into `experimental.chat.system.transform` to inject questions
- Questions are generated based on the current prompt context
- Each question is unique within the session history

## Usage

The token predictor runs automatically in DREAM_INNOVATION mode. No manual invocation needed.

## Files

- `scripts/predict.py` — Main Python script for question generation
- `SKILL.md` — This file (skill metadata)

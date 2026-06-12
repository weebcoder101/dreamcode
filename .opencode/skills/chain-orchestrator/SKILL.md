---
name: chain-orchestrator
description: >
  Chain execution manager: validates dependencies, enforces order,
  tracks violations. Use to verify that all required skill chains
  were executed and to get the correct execution order.
category: META
chains_with: []
triggers:
  - chain
  - orchestrator
  - validate
  - execution order
---

# Chain Orchestrator Skill

## Purpose

Manages skill chain execution order, validates dependencies are met,
and tracks violations when chains are skipped.

## Architecture

```
Prompt → Classifier → Chain Selection → Orchestrator → Execution → Enforcer
                                ↓                           ↓
                        Chain DAG (31 skills)        Violation Log
```

## Core Chain (always runs)

```
context-compactor → exhaustive-crosscheck → neuro → model-router →
code-hardener → lint-fixer → pieces-ltm → automated-learning
```

## Task-Specific Chains

| Task Type | Additional Skills |
|-----------|-------------------|
| debugging | debugging, testing |
| security | security, code-hardener |
| architecture | architecture, planning |
| performance | performance, quality |
| documentation | documentation, communication |
| refactoring | refactoring, quality |
| testing | testing, quality |

## Usage

```bash
# Get chain for a prompt
python .opencode/skills/chain-orchestrator/scripts/classifier.py \
    --prompt "Fix the numpy bug"

# Validate all chains
python .opencode/skills/chain-orchestrator/scripts/orchestrator.py \
    --validate

# Show execution dashboard
python .opencode/skills/chain-orchestrator/scripts/orchestrator.py \
    --dashboard

# Record skill execution
python .opencode/skills/chain-orchestrator/scripts/enforcer.py \
    --record neuro
```

## Violation Tracking

Violations are logged to `evolution/chain_execution.jsonl`:
- Missing dependencies
- Skipped skills
- Incorrect execution order

## References

- Orchestrator: `.opencode/skills/chain-orchestrator/scripts/orchestrator.py`
- Classifier: `.opencode/skills/chain-orchestrator/scripts/classifier.py`
- Enforcer: `.opencode/skills/chain-orchestrator/scripts/enforcer.py`

---
name: automation
description: "Trigger-driven automation definitions and runner management. Use when creating, running, or managing skill-based automation pipelines."
chains_with:
  - quality
  - automated-learning
---

# Automation Skill — Always-On Skill Pipelines

## Overview

Automations connect **triggers** (events, schedules, file changes) to **skill pipelines** (our 25 skills) to produce **actions** (PRs, comments, Slack messages, reports).

Each automation is a YAML file in `automations/definitions/` that declares:
- A trigger (GitHub event, cron schedule, file change, CLI)
- A skill pipeline (ordered list of skills to invoke)
- Actions (what to do with results)

## Trigger Types

| Type | How to Fire | Example |
|------|------------|---------|
| `github` | PR opened/pushed | `automate.py run pr-security-review` |
| `cron` | Scheduled via system crontab | `automate.py cron-install` |
| `file_watch` | File changes on disk | `automate.py watch .` |
| `cli` | Manual invocation | `automate.py run generate-docs` |

## Commands

```bash
# List all available automations
python .opencode/scripts/automate.py list

# Run an automation once
python .opencode/scripts/automate.py run pr-security-review

# Run all automations
python .opencode/scripts/automate.py run-all

# Watch directory for file changes (daemon)
python .opencode/scripts/automate.py watch .

# Install cron jobs from automation schedules
python .opencode/scripts/automate.py cron-install

# View run history
python .opencode/scripts/automate.py status
```

## Adding an Automation

1. Create a YAML file in `automations/definitions/`
2. Declare trigger, pipeline, and actions
3. Run it: `python .opencode/scripts/automate.py run <name>`

## Pipeline Design

Pipelines compose skills sequentially. Each step can be:
- A skill name string: `"security"`
- A skill object with config: `{skill: "security", config: {severity: "high"}}`
- A conditional step: `{skill: "security", when: "severity == critical"}`

## Automation Templates

| Template | Trigger | Pipeline | Action |
|----------|---------|----------|--------|
| PR Security Review | GitHub PR | exhaustive-crosscheck → security → code-hardener | PR comment + Slack alert |
| Nightly Audit | Cron | quality → security → performance | File report + log |
| Add Test Coverage | GitHub PR | testing → quality → python | PR comment |
| Find Critical Bugs | Cron | exhaustive-crosscheck → debugging → code-hardener | Draft PR + log |
| Generate Docs | CLI | documentation → communication | Git commit |
| Weekly Summary | Cron | communication → data | File report |

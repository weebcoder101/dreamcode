---
name: scheduled-automations
description: Cron-like scheduled automation engine. Define jobs that run on schedule — nightly security audits, weekly dependency checks, code quality reports. Trigger skill chains from cron or on-demand.
category: META
chains_with: [automation, neuro, security, quality, automated-learning]
---

# Scheduled Automations

Cron-like job engine that triggers skill chains on schedule.

## Quick Start

### Define a job

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py \
  add nightly-audit \
  --schedule "0 2 * * *" \
  --chain "security → quality → neuro" \
  --prompt "Run full security audit and code quality check" \
  --notify
```

### Run a job now (on-demand)

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py run nightly-audit
```

### List all jobs

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py list
```

### View run history

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py history nightly-audit
```

### Remove a job

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py remove nightly-audit
```

## Schedule Syntax

Standard cron format: `MIN HOUR DAY MONTH DOW`

| Schedule | Description |
|----------|-------------|
| `0 2 * * *` | Daily at 2:00 AM |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 0 1 * *` | First of every month |
| `*/30 * * * *` | Every 30 minutes |
| `0 22 * * 5` | Every Friday at 10:00 PM |

## Built-in Job Templates

| Job | Schedule | Chain |
|-----|----------|-------|
| `nightly-audit` | Daily 2 AM | security → quality → neuro |
| `weekly-deps` | Monday 9 AM | quality → neuro |
| `pre-deploy` | On-demand | security → testing → quality |
| `code-review` | On-demand | neuro → code-hardener → lint-fixer |

## Agent Integration

The agent can:
1. Add jobs: `scheduler.py add <name> --schedule "..." --chain "..."`
2. Run jobs now: `scheduler.py run <name>`
3. Check history: `scheduler.py history <name>`
4. The scheduler stores jobs in `.opencode/automations/jobs.json`
5. Run history is stored in `.opencode/automations/history.jsonl`

## System Cron Integration

To actually run on schedule, add to system crontab:
```bash
# Edit crontab
crontab -e

# Add this line (runs the scheduler's due jobs every minute)
* * * * * cd $(pwd) && python3 .opencode/skills/scheduled-automations/scripts/scheduler.py tick >> /tmp/scheduler.log 2>&1
```

The `tick` command checks for due jobs and runs them.

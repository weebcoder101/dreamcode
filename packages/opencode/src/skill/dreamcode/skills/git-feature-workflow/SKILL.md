---
name: git-feature-workflow
description: Codex-style git feature workflow — start, pr, finish, status. Wraps git + gh into a clean feature branch lifecycle. Use when creating features, opening PRs, or merging branches.
category: TOOL
chains_with: [git, quality, automated-learning]
---

# Git Feature Workflow

Codex-style feature branch lifecycle: `start` → work → `pr` → `finish`.

## Commands

### `feature start <name>`

Creates and checks out a feature branch from the current base branch.

```bash
python3 .opencode/skills/git-feature-workflow/scripts/feature.py start my-feature
python3 .opencode/skills/git-feature-workflow/scripts/feature.py start my-feature --base main
```

Behavior:
- Stashes any uncommitted changes
- Creates `feature/<slug>` from base branch (default: main)
- Pushes branch to origin
- Returns to original branch after setup

### `feature pr`

Pushes the current feature branch and opens a PR via `gh`.

```bash
python3 .opencode/skills/git-feature-workflow/scripts/feature.py pr
python3 .opencode/skills/git-feature-workflow/scripts/feature.py pr --title "Add login" --reviewer alice
```

Behavior:
- Pushes current branch to origin
- Creates PR via `gh pr create`
- Adds title, body, reviewers, labels if provided
- Returns PR URL

### `feature finish`

Merges the current feature branch back into base (only if CI green).

```bash
python3 .opencode/skills/git-feature-workflow/scripts/feature.py finish
python3 .opencode/skills/git-feature-workflow/scripts/feature.py finish --no-delete
```

Behavior:
- Checks if CI checks pass (via `gh pr checks`)
- Squash-merges into base branch
- Deletes feature branch locally and remotely
- Switches back to base branch

### `feature status`

Shows current branch info, linked PR, and CI state.

```bash
python3 .opencode/skills/git-feature-workflow/scripts/feature.py status
```

## Integration with Agent

The agent can call these scripts directly:
1. User says "start a feature for login" → agent runs `feature.py start login`
2. User says "open a PR" → agent runs `feature.py pr`
3. User says "merge it" → agent runs `feature.py finish`

## Prerequisites

- `git` (obviously)
- `gh` CLI (GitHub CLI) — authenticated
- Clean working directory recommended

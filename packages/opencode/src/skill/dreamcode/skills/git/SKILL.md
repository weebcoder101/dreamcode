---
name: git
description: "Git operations, branching strategy, commit conventions, and PR workflow. Use for all git operations. Enforces clean history and conventional commits."
chains_with:
  - quality
  - automated-learning
---

# Git Workflow — Clean History, Clean Conscience

## Branch Strategy

```
main              # Production-ready, protected
  └─ develop      # Integration branch
       ├─ feature/*    # New features
       ├─ fix/*        # Bug fixes
       ├─ refactor/*   # Code refactoring
       └─ experiment/* # Experimental work
```

## Commit Convention

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Usage | Version bump |
|------|-------|--------------|
| `feat` | New feature | MINOR |
| `fix` | Bug fix | PATCH |
| `refactor` | Code change (no behavior change) | PATCH |
| `perf` | Performance improvement | PATCH |
| `test` | Adding/fixing tests | — |
| `docs` | Documentation | — |
| `style` | Formatting, linting | — |
| `ci` | CI/CD changes | — |
| `chore` | Maintenance | — |
| `revert` | Revert a change | — |

### Rules

- Imperative mood: "Add feature" NOT "Added feature"
- First line ≤ 72 characters
- Body wraps at 72 characters
- Scope is optional but encouraged
- Footer for breaking changes: `BREAKING CHANGE: description`

## PR Workflow

### Before Creating a PR
- [ ] All tests pass: `pytest tests/ -x -q`
- [ ] Lint clean: `ruff check src/`
- [ ] Types clean: `mypy src/`
- [ ] Branch is rebased on target
- [ ] Commit history is clean (squash WIP commits)

### PR Template
```markdown
## Description
[What this PR does]

## Type
- [ ] feat: New feature
- [ ] fix: Bug fix
- [ ] refactor: Code restructuring
- [ ] test: Test changes
- [ ] docs: Documentation

## Testing
- [ ] Unit tests added/updated
- [ ] All tests pass
- [ ] Manual testing done

## Breaking Changes
[None, or describe]

## Related Issues
Closes #[issue]
```

### Review Etiquette

- Request reviews from relevant team members
- Respond to comments within 24 hours
- Keep PRs under 400 lines when possible
- Large PRs → break into stacked PRs

## Risky Operations

| Operation | Risk | Approval Needed |
|-----------|------|----------------|
| Force push | HIGH | NEVER on shared branches |
| Rebase shared branch | HIGH | Coordinate with team |
| Merge without review | HIGH | Emergency only |
| Delete remote branch | MEDIUM | Verify merged first |
| Amend push | MEDIUM | Only if branch is yours |

---
name: quality
description: "Code quality enforcement, linting, type checking, and best practices. Use after every code change to ensure production-grade quality. Integrates with ruff, mypy, pylint, and other quality tools."
chains_with:
  - lint-fixer
  - automated-learning
---

# Code Quality Skill — Ship Clean

## Mandate

Every file that touches the codebase must pass the quality gate. No exceptions.

## Trigger Conditions

Fire this skill ALWAYS after completing implementation. Must be the final step before presenting results to the user.

## Quality Gate Checklist

### 1. Static Analysis
```bash
# Python
ruff check src/ tests/ benchmarks/
ruff check --fix src/ tests/ benchmarks/
ruff format --check src/ tests/

# Type checking
mypy src/

# Import sorting
ruff check --select I src/ tests/
```

### 2. Test Suite
```bash
# Run all tests
python -m pytest tests/ -x -q

# Run with coverage
python -m pytest tests/ --cov=src/ --cov-report=term

# Run benchmarks (smoke)
python -m pytest benchmarks/ --benchmark-min-rounds=1 -x -q
```

### 3. Common Python Issues

| Check | Tool | What to fix |
|-------|------|-------------|
| Unused imports | ruff F401 | Remove or use |
| Unused variables | ruff F841 | Remove or prefix with `_` |
| Bare except | ruff E722 | Specify exception type |
| Mutable defaults | ruff B006 | Use `None` + `if x is None` |
| Line too long | ruff E501 | Break lines |
| Missing type hints | mypy | Add annotations |
| Any return type | mypy | Be specific |
| Untyped dict/list | mypy | Use `dict[str, Any]` |

### 4. JavaScript/TypeScript
```bash
# ESLint
npx eslint --fix src/

# TypeScript
npx tsc --noEmit

# Prettier
npx prettier --write src/
```

### 5. Documentation Quality

- All public functions have docstrings
- All parameters are documented
- Return types are documented
- Raises are documented
- Complex logic has inline comments explaining WHY (not what)

## Speed Rules

For quick quality checks during development:

```bash
# Fastest: just static analysis
ruff check src/

# Medium: static + types
ruff check src/ && mypy src/

# Full: everything
ruff check src/ && mypy src/ && pytest tests/ -x -q
```

## Quality Escalation

| Issue Count | Action |
|-------------|--------|
| 0 | Ship it |
| 1-3 | Fix all, recheck |
| 4-10 | Flag to user, discuss priority |
| 10+ | STOP. Major quality issue. |

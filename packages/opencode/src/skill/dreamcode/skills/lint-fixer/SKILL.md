---
name: lint-fixer
description: Mandatory post-implementation lint and type-checking skill that runs after ANY code change, bug fix, new feature, refactor, API change, or configuration modification. Ensures all ruff lint errors, mypy type errors, and ESLint issues are resolved. Use after every implementation that modifies source files. Use when code has been edited. Use for every response where file edits were made.
chains_with: [automated-learning]
---

# Lint Fix Skill - Mandatory Post-Implementation Pipeline

## Purpose
This skill runs **MANDATORILY** after the full NEURO (10 iterations) + code-hardener (5 iterations) + 15-iteration final review gate chain has completed and implementation has been performed. It ensures:
1. All ruff lint errors are resolved
2. All mypy type errors are resolved
3. No new lint/type issues are introduced
4. Code follows the project's strict quality standards

## When to Invoke
This skill **MUST** be invoked in EVERY response where:
- The full 15-iteration chain (NEURO 10 + code-hardener 5) has completed
- The 15-iteration final review has been produced
- Implementation has been performed based on the approved manifest
- Any file edits were made to the codebase

## Integration with 15-Iteration Chain

The mandatory full sequence is:
1. User request
2. NEURO review — 10 progressive iterations
3. Code-hardener — 5 progressive iterations
4. 15-iteration final review gate
5. Implementation (only after final review approval)
6. **LINT-FIXER SKILL** (this skill) ← MANDATORY
7. Final validation & response to user

**NO RESPONSE SHOULD BE SENT TO USER WITHOUT COMPLETING THIS SKILL**

## Workflow - 5 Iterative Loops

### Loop 1: Ruff Check & Fix
```
RUN: ruff check src/ tests/ benchmarks/
IF errors found:
  - Auto-fix with: ruff check --fix src/ tests/ benchmarks/
  - Report fixed errors
  - If any remain, invoke NEURO for architectural review
```

### Loop 2: Mypy Type Check & Fix
```
RUN: mypy src/
IF errors found:
  - Categorize errors (Any return, Type assignment, Union handling)
  - Apply type annotations (NDArray, list[float], cast, etc.)
  - If complex type issues, invoke NEURO for guidance
```

### Loop 3: Import Order & Format Fix
```
RUN: ruff check --select I src/ tests/
IF import errors:
  - Organize imports with ruff
  - Move imports to top of files
  - Remove unused imports
```

### Loop 4: Complex Pattern Detection
```
SCAN for complex patterns that commonly cause issues:
- List comprehension with np.array reassignment
- Optional type (X | None) without null checks
- pd.DataFrame.values without type annotation
- np.array operations without explicit dtype

IF found:
  - Fix with proper patterns
  - Document in this skill for future detection
```

### Loop 5: NEURO Integration - Full Validation
```
INVOKE NEURO with the complete context:
- Current file changes
- All lint fixes applied
- Type annotations added
- Any remaining issues

NEURO REVIEW:
- Validate no regressions introduced
- Check for potential bugs in the fixes
- Ensure code quality maintained
- Provide architectural sign-off

IF NEURO approves:
  - Skill complete, ready to respond to user
IF NEURO rejects:
  - Iterate back to Loop 1 with NEURO feedback
```

## Key Fix Patterns

### Type Annotation Patterns
```python
# Fix: Any return from function
def func() -> NDArray[np.float64]:
    result: NDArray[np.float64] = np.array(...)
    return result

# Fix: List to ndarray reassignment
var_list: list[float] = []
for i in range(n):
    var_list.append(compute())
var_arr = np.array(var_list, dtype=np.float64)

# Fix: Optional type iteration
assets = scenario_transform.assets
if assets is None:
    raise ValueError("assets cannot be None")
for a in assets:
    ...

# Fix: DataFrame values
if isinstance(samples, pd.DataFrame):
    arr: NDArray[np.float64] = samples.values.astype(np.float64)
    return arr
```

### Import Patterns
```python
# Always at top of file
from __future__ import annotations
import numpy as np
import pandas as pd
from typing import Any, TYPE_CHECKING
# ... other imports
```

## Files to Always Check
- src/project_q/simulation/monte_carlo.py
- src/project_q/simulation/scenario_transform.py
- src/project_q/risk/metrics.py
- src/project_q/copula/fitting.py
- src/project_q/dashboard/api_server.py
- src/project_q/dependence/engine.py
- src/project_q/dependence/metrics.py
- All frontend JavaScript/JSX files
- All test files

## Execution Command
```bash
ruff check src/ tests/ benchmarks/ --fix
mypy src/
```

## Exit Criteria
- ruff check: All checks passed
- mypy src/: Success: no issues found
- No new warnings introduced
- NEURO has provided sign-off (for Loop 5)

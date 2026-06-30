---
name: python-best-practices
description: "Python development standards, typing, imports, and project structure. Use for all Python code in the project. Covers modern Python tooling with ruff, mypy, pytest."
chains_with:
  - quality
  - lint-fixer
---

# Python Best Practices

## Mandate

All Python code must be type-annotated, lint-clean, and tested. Modern Python (3.12+) tooling required.

## Standards

### Formatting & Linting
```bash
# MUST pass before commit
ruff check src/ tests/
ruff format --check src/
mypy src/ --strict
```

### Types

| Construct | Correct | Incorrect |
|-----------|---------|-----------|
| Dict | `dict[str, int]` | `dict` |
| Optional | `x: str \| None` | `Optional[str]` |
| List | `list[float]` | `List[float]` |
| Callable | `Callable[[int], str]` | `callable` |
| Multiple return | `-> tuple[int, str]` | `-> tuple` |
| DataFrame | `pd.DataFrame` | Accept if typed |
| NDArray | `NDArray[np.float64]` | `np.ndarray` |

**Never** use bare `Any` where a concrete type exists.

### Imports

Order:
1. Standard library (`os`, `sys`, `json`, `pathlib`, `typing`)
2. Third-party (`numpy`, `pandas`, `flask`)
3. First-party (`project_q.*`)
4. Local (relative imports)

Within groups: alphabetical. Use `ruff check --select I` to auto-fix.

### Naming

| Element | Style | Example |
|---------|-------|---------|
| Classes | PascalCase | `MonteCarloEngine` |
| Functions | snake_case | `compute_var()` |
| Variables | snake_case | `portfolio_returns` |
| Constants | UPPER_SNAKE | `DEFAULT_ASSETS` |
| Private | _prefix | `_internal_fn()` |
| Protected | _prefix | `_protected_attr` |
| Type vars | PascalCase | `T`, `ResultT` |

### Docstrings

Google style for all public functions:

```python
def compute_var(returns: NDArray[np.float64], alpha: float = 0.95) -> float:
    """Compute Value at Risk.
    
    Args:
        returns: Portfolio return series.
        alpha: Confidence level (default 0.95).
    
    Returns:
        VaR estimate at given confidence level.
    
    Raises:
        ValueError: If returns is empty.
    """
```

## Project Structure

```
src/project_q/
  __init__.py          # Public API exports
  logging.py           # Logger configuration
  dashboard/           # API server, routes
  risk/                # Risk computation
  copula/              # Copula models
  volatility/          # GARCH models
  quantum/             # Quantum primitives
  simulation/          # Monte Carlo engine
  data/                # Data pipeline

tests/
  conftest.py          # Shared fixtures
  test_*.py            # Test modules
```

## Dependencies

### Core
- `numpy` — numerical computing
- `pandas` — data manipulation  
- `scipy` — statistics, optimization
- `arch` — GARCH modeling

### Testing
- `pytest` — test framework
- `pytest-cov` — coverage
- `pytest-benchmark` — performance tests

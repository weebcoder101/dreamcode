---
name: testing
description: "Testing strategy, test writing, and coverage standards. Use when writing or reviewing tests. Covers unit, integration, property-based, and benchmark tests."
chains_with:
  - lint-fixer
  - automated-learning
---

# Testing Skill — If It's Not Tested, It's Broken

## Mandate

Every non-trivial code change MUST include tests. No exceptions.

## Trigger Conditions

- New function/module created
- Bug fix (regression test required)
- API endpoint added/changed
- Data contract changed
- Performance-critical code changed

## Test Types

### Unit Tests
- Test one function/class in isolation
- Mock external dependencies
- Fast (< 100ms per test)
- Location: `tests/test_<module>.py`

```python
def test_compute_var_returns_positive():
    returns = np.array([-0.02, -0.01, 0.0, 0.01, 0.02])
    result = compute_var(returns, alpha=0.95)
    assert result > 0
    assert isinstance(result, float)
```

### Integration Tests
- Test component interaction
- Use real dependencies (test DB, test API)
- Slower but verify contracts
- Location: `tests/test_<feature>_integrations.py`

### Property-Based Tests
- Test invariants with random inputs
- Use `hypothesis` library
- Find edge cases you didn't think of

```python
from hypothesis import given, strategies as st

@given(st.lists(st.floats(min_value=-1, max_value=1), min_size=10))
def test_var_always_positive(returns):
    result = compute_var(np.array(returns))
    assert result >= 0
```

### Performance Tests
- Use `pytest-benchmark`
- Define SLO thresholds

```python
def test_monte_carlo_slo(benchmark):
    result = benchmark(monte_carlo_run, n_scenarios=5000)
    assert result < 5.0  # seconds
```

## Coverage Standards

| Type | Coverage Target | Notes |
|------|----------------|-------|
| Core logic | 95%+ | Risk calculations, models |
| API endpoints | 90%+ | Request/response validation |
| Data pipeline | 85%+ | ETL, transformations |
| UI components | 70%+ | Integration-level |
| Error handling | 100% | Every exception path |

## Testing Rules

1. **One assertion concept per test**: If test A fails, you know exactly what broke
2. **Arrange-Act-Assert**: Setup → execute → verify
3. **Test the behavior, not the implementation**: Refactoring shouldn't break tests
4. **Regression tests first**: When fixing a bug, write the test that fails first
5. **No network in unit tests**: Mock all external calls
6. **Deterministic**: Same inputs → same results
7. **Fast**: Test suite should run in < 30 seconds
8. **Isolated**: Tests can run in any order

## Test File Structure

```python
"""Tests for module_name."""

import pytest
import numpy as np
from project_q.module import function


class TestFunctionName:
    """Tests for function()"""
    
    def test_basic_case(self):
        """Verify normal behavior."""
        ...
    
    def test_edge_case_empty(self):
        """Verify behavior with empty input."""
        ...
    
    def test_error_invalid_input(self):
        """Verify proper error on invalid input."""
        with pytest.raises(ValueError):
            ...
    
    @pytest.mark.parametrize("input,expected", [
        (1, 2),
        (5, 10),
        (-1, -2),
    ])
    def test_parameterized(self, input, expected):
        """Verify multiple cases."""
        ...
```

---
name: refactoring
description: "Safe refactoring methodology. Use when restructuring existing code without changing behavior. Covers patterns for incremental improvement, testing during refactors, and risk management."
chains_with:
  - code-hardener
  - lint-fixer
---

# Refactoring Skill — Change Structure, Preserve Behavior

## First Rule

**Refactoring changes the structure, not the behavior.** If behavior changes, it's not refactoring — it's rewriting.

## Process

### Step 1: Understand Current Code
- Read the code completely
- Identify inputs, outputs, side effects
- Find existing tests
- If no tests exist, write characterization tests first

### Step 2: Define Target State
```python
# Current
def process(data):
    # 50 lines of mixed logic

# Target
def process(data):
    validated = validate(data)
    transformed = transform(validated)
    return analyze(transformed)
```

### Step 3: Identify Safe Extraction Points

Look for:
- Repeated code blocks → extract to function
- Long functions → extract named steps
- Deep conditionals → extract to guard clauses
- Mixed responsibilities → split classes/modules
- Hardcoded values → extract to constants/parameters

### Step 4: Refactor in Small Steps

Each step:
1. Extract/move/rename
2. Run tests
3. Commit
4. Repeat

### Step 5: Verify
- [ ] Same inputs → same outputs
- [ ] All existing tests pass
- [ ] No new lint/type warnings
- [ ] Performance not degraded (±10%)

## Safe Refactoring Patterns

### Extract Function
```python
# Before
def calculate_risk(returns):
    mean = returns.mean()
    std = returns.std()
    var_95 = returns.quantile(0.05)
    return {"mean": mean, "std": std, "var_95": var_95}

# After
def calculate_risk(returns):
    return {
        "mean": _mean(returns),
        "std": _std(returns),
        "var_95": _var_95(returns),
    }

def _mean(returns): return returns.mean()
def _std(returns): return returns.std()
def _var_95(returns): return returns.quantile(0.05)
```

### Rename for Clarity
```python
# Before
x = calc(r, 0.95)

# After
value_at_risk = compute_parametric_var(portfolio_returns, confidence_level=0.95)
```

### Replace Conditional with Polymorphism
```python
# Before
def compute(regime):
    if regime == "normal":
        return normal_compute()
    elif regime == "stress":
        return stress_compute()
    else:
        raise ValueError(f"Unknown regime: {regime}")

# After
strategies = {"normal": normal_compute, "stress": stress_compute}
def compute(regime):
    fn = strategies.get(regime)
    if not fn:
        raise ValueError(f"Unknown regime: {regime}")
    return fn()
```

## When Not to Refactor

- Code is about to be rewritten anyway
- Code is working and not being modified
- Refactoring would break a known contract
- The risk of regression > the benefit of cleanup
- Deadline pressure (refactor in a follow-up PR)

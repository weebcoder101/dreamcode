---
name: debugging
description: "Systematic debugging methodology. Use when encountering unexpected behavior, test failures, or production issues. Covers reproduce-isolate-fix-verify cycle."
chains_with:
  - code-hardener
  - automated-learning
---

# Debugging Skill — Systematic Fault Isolation

## Mandate

Do not guess. Do not change random things. Follow the scientific method: hypotheses → predictions → experiments → evidence.

## Trigger Conditions

- Test failure
- Unexpected behavior
- Performance regression
- Production incident
- User reports a bug

## Protocol: LSP-First, Cheapest Validation First

Read PROTOCOL.md in this skill directory and follow it. Summary: tool ladder lsp (50ms) > relations (1-3s) > grep (1-3s) > read > bash; validation ladder targeted-test > dev-run > fresh typecheck > full build LAST. State your hypothesis + the cheapest validation before any expensive command.

## Process

### Phase 1: Reproduce (10%)
1. Get the exact steps, inputs, and environment
2. Can you reproduce reliably? If not, fix flakiness first
3. Create a minimal reproduction case
4. Document: what you expected vs. what happened

### Phase 2: Isolate (40%)
1. **Binary search**: Cut the problem space in half repeatedly
   - If it's a 1000-line file, check line 500 → narrow
   - If it's a pipeline, check each stage independently
2. **Simplify**: Remove parts until the bug disappears, then add back
3. **Compare**: Find a working version and diff it
4. **Check assumptions**: Is `assert x > 0` actually true? Verify each assumption

```python
# Isolation pattern
def test_isolation():
    # Step 1: Does the basic function work?
    result = basic_fn()
    assert result is not None
    
    # Step 2: Does it work with this specific input?
    result = basic_fn(specific_input)
    
    # Step 3: Where exactly does it fail?
    # Add assertions at each step
```

### Phase 3: Understand (30%)
Once isolated, understand the ROOT CAUSE:

- **What**: State the bug in one sentence
- **Why**: What condition causes it? (not "the code is broken")
- **Impact**: What can go wrong because of this?
- **Trigger**: What specific input/state triggered it?

### Phase 4: Fix (10%)
1. Smallest possible change to fix the root cause
2. Add a regression test that would catch re-introduction
3. Verify the fix doesn't break anything else

### Phase 5: Verify (10%)
- [ ] Bug is fixed (reproduction case now passes)
- [ ] Regression test added
- [ ] All existing tests still pass
- [ ] Edge cases considered (empty, boundary, error)

## Common Python Debugging

```bash
# Trace execution
python -m trace --trace script.py | head -100

# Profile
python -m cProfile -o profile.out script.py
python -m pstats profile.out

# Debug
python -m pdb script.py

# Assertions on
python -O script.py  # Disables asserts
```

## Debugging by Symptom

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| Wrong output | Off-by-one, wrong formula | Input values, operators |
| Crash | Null/None, type error | Type annotations, bounds |
| Hang | Infinite loop, deadlock | Loop conditions, locking |
| Slow | N+1 query, O(n²) algo | Query count, complexity |
| Memory leak | Unclosed resources, cache | File handles, collections |
| Intermittent | Race condition, timing | Async, shared state |
| Regression | Recent change | `git bisect` |

## Tools

```bash
# Git bisect — find which commit introduced a bug
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
# Git will checkout commits; run your test and mark good/bad
git bisect run pytest tests/test_bug.py  # Automated!

# Print debugging (temporary)
# Add at the suspicious location:
import pdb; pdb.set_trace()
```

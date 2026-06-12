---
name: performance
description: "Performance analysis, profiling, and optimization. Use when optimizing slow code, reducing memory, or scaling to larger datasets. Covers profiling, bottleneck identification, and optimization patterns."
chains_with:
  - code-hardener
  - automated-learning
---

# Performance Skill — Measure Before You Optimize

## First Rule

**Do not optimize without profiling first.** Intuition about bottlenecks is wrong 80% of the time.

## Trigger Conditions

- Code is "slow" (user reports latency)
- Processing larger datasets than before
- API endpoint latency > SLO
- Memory usage growing unexpectedly
- Scaling to more users/assets/scenarios
- Benchmark test fails its SLO

## Process

### Step 1: Profile (mandatory)

```bash
# Wall time — find what's slow
python -m cProfile -o profile.out my_script.py

# Line-by-line timing
pip install line_profiler
kernprof -l -v my_script.py

# Memory profiling
pip install memory_profiler
python -m memory_profiler my_script.py

# Python-native
import time
t0 = time.perf_counter()
# ... code ...
print(f"Took {time.perf_counter() - t0:.3f}s")
```

### Step 2: Identify bottleneck

| Bottleneck | Profile signature | Fix |
|------------|-------------------|-----|
| CPU-bound | High time in function | Vectorize, cache, reduce complexity |
| I/O-bound | Many syscalls, waiting | Async, batch, buffer |
| Memory-bound | Growing RSS | Streaming, generators, chunking |
| N+1 queries | Many SQL queries | JOIN, prefetch, batch |
| Lock contention | Threads waiting | Reduce shared state, shard |

### Step 3: Apply optimization

#### NumPy/Pandas Optimization

```python
# BAD: Looping
for i in range(len(df)):
    df.iloc[i, 'result'] = df.iloc[i, 'a'] * df.iloc[i, 'b']

# GOOD: Vectorized
df['result'] = df['a'] * df['b']
```

#### Algorithm Selection

| n | O(n²) | O(n log n) | O(n) |
|---|-------|------------|------|
| 100 | 0.01ms | 0.007ms | 0.001ms |
| 1,000 | 1ms | 0.1ms | 0.01ms |
| 10,000 | 100ms | 1ms | 0.1ms |
| 100,000 | 10s | 12ms | 1ms |
| 1,000,000 | 16min | 140ms | 10ms |

#### Caching

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def expensive_function(param: int) -> float:
    # Only computed once per unique param
    ...
```

### Step 4: Verify

- [ ] Measure improvement (time/memory before → after)
- [ ] Verify correctness (same results?)
- [ ] Check for regressions in other areas
- [ ] Update benchmarks if SLO changed

## Project-Q Specific Optimizations

### Monte Carlo
- Bootstrap CI is dominant cost (40%). Keep n_bootstrap=1000.
- Scenario generation scales O(n_scenarios × n_assets)
- Cholesky decomposition is O(n_assets³) — pre-compute covariance

### Data Pipeline
- Parquet with column pruning: don't load columns you don't need
- Use `pd.read_parquet(columns=[...])`
- Process in chunks for large datasets

### API Server
- Cache risk metrics with TTL (already implemented: `_risk_metrics_cache`)
- Use connection pooling for DB/queries
- Profile with `curl -w "%{time_total}"` before/after

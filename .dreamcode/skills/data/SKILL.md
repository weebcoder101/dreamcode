---
name: data
description: "Data science and statistical analysis best practices. Use for data analysis, statistical modeling, visualization, and numerical computation. Covers pandas/numpy patterns, statistical methodology, and reproducibility."
chains_with:
  - automated-learning
---

# Data Science Skill — Rigorous, Reproducible, Documented

## Mandate

Every analysis must be reproducible. Every result must have a confidence interval. Every assumption must be stated.

## Data Manipulation (Pandas)

### Loading
```python
# Column pruning — only load what you need
df = pd.read_parquet("data.parquet", columns=["date", "returns", "volume"])

# Chunked processing for large data
chunks = pd.read_csv("big.csv", chunksize=10000)
result = pd.concat([process(c) for c in chunks])
```

### Cleaning Checklist
- [ ] Missing values: why are they missing? (MCAR, MAR, MNAR)
- [ ] Outliers: cap, clip, or keep? Document decision.
- [ ] Duplicates: check for exact and near-duplicates
- [ ] Data types: datetime, categorical, float
- [ ] Index: is it unique? sorted?
- [ ] Range checks: min/max within expected bounds

### Common Patterns

```python
# Rolling window
df['volatility'] = df['returns'].rolling(21).std() * np.sqrt(252)

# Groupby aggregations
df.groupby('ticker').agg({'returns': ['mean', 'std', 'skew', 'kurt']})

# Forward fill for financial data
df = df.fillna(method='ffill')

# Quantile-based
var_95 = df['returns'].quantile(0.05)
tail = df[df['returns'] <= var_95]
es_95 = tail['returns'].mean()
```

## Statistical Rigor

### Always Report
- Point estimate
- Confidence interval (95%)
- Sample size
- Test statistic and p-value
- Effect size

### Hypothesis Testing
```python
from scipy import stats

# Normality test
stat, p = stats.normaltest(returns)
# p < 0.05 → NOT normal (likely for financial data)

# Correlation test
r, p = stats.pearsonr(returns_a, returns_b)

# Two-sample test
stat, p = stats.ks_2samp(sample_1, sample_2)

# Jarque-Bera test for normality
stat, p = stats.jarque_bera(returns)
```

### Model Validation
- Train/test split (temporal for time series!)
- Cross-validation (walk-forward for financial data)
- Out-of-sample testing (mandatory)
- Overfitting check: simpler model that performs almost as well?

## Visualization

### Chart Selection
| Data type | Chart | Library |
|-----------|-------|---------|
| Distribution | Histogram, KDE | matplotlib/seaborn |
| Time series | Line, area | matplotlib |
| Correlation | Heatmap | seaborn |
| Comparison | Bar, box plot | matplotlib |
| Relationship | Scatter | matplotlib |
| Distribution pairs | Pairplot | seaborn |
| Tail risk | Q-Q plot | scipy |


### Plot Standards
- Title: descriptive
- X/Y labels: include units
- Legend: present when multiple series
- Source: at bottom
- Size: readable (default figsize=(10, 6))
- Color: colorblind-friendly palette

## Reproducibility
- Set random seed: `np.random.seed(42)`
- Record all parameters
- Version data and code together
- Use relative paths, not absolute
- Save processed data with pipeline metadata

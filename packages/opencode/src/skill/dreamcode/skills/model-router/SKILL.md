---
name: model-router
description: >
  Intelligent model selection engine for NEURO API. Automatically identifies
  which of 120+ models are optimal for a given task, then routes execution
  to the right models. Integrates with every skill chain to ensure multi-model
  intelligence on every non-trivial operation.
category: META
chains_with:
  - neuro
  - code-hardener
  - lint-fixer
  - exhaustive-crosscheck
triggers:
  - model
  - route
  - select
  - which model
  - multi-model
  - clawpack
---

# Model Router Skill

## Purpose

Analyzes task context and selects the optimal combination of NEURO models
for maximum effectiveness. Every skill chain should invoke this router
before calling the NEURO API to ensure multi-model intelligence.

## The Problem

Previously, we used only `neurometric/clawpack` for everything.
NEURO has **120+ specialized models** — we were using 1.

## The Solution

```
Task Context → Model Router → Optimal Model Set → NEURO API
                 ↓
         ┌───────┴───────┐
         │  120+ Models  │
         │  categorized  │
         │  by domain    │
         └───────────────┘
```

## Model Categories (120+ models)

| Category | Count | Examples |
|----------|-------|----------|
| CODE | 10+ | clawpack-coding, code-writer, code-refactorer, regex-gen, bash-medic |
| SECURITY | 5+ | auth-guard, policy-check, reg-compliance, conflict-check |
| FINANCE | 10+ | stock-val, cash-flow-ref, risk-evaluator, ratio-analyzer |
| LEGAL | 8+ | legal-template, contract-risk-analyzer, clause-extractor |
| HR | 8+ | jd-writer, interview-analyst, offer-architect, bias-check |
| MARKETING | 10+ | promo-writer, keyword-king, ppc-pilot, landing-optimize |
| SALES | 6+ | battlecard-gen, closer-ai, churn-guard, deal-sieve |
| SUPPORT | 6+ | support-poly, empathy-edge, trouble-shoot, ticket-clean |
| DATA | 6+ | chart-mapper, anomaly-sense, trend-spotter, text-to-sql |
| DOCUMENT | 10+ | prd-draft, design-doc, release-logs, doc-master |
| OPERATIONS | 8+ | eisenhower-bot, milestone-check, goal-setter, sign-flow |
| GENERAL | 5+ | clawpack, clawpack-pro, clawpack-general, owlpack-general |

## Routing Logic

### Step 1: Analyze Task Context

```python
context = router.analyze_task(
    task_description="Review the payment gateway integration for security vulnerabilities",
    skills=["security", "code-hardener"]
)
# Result: TaskContext(
#   task_type="security_review",
#   skills=["security", "code-hardener"],
#   domain="security",
#   complexity="high",
#   language=None,
#   keywords=["payment", "gateway", "security", "vulnerabilities"]
# )
```

### Step 2: Select Models

```python
selection = router.select_models(context)
# Result: ModelSelection(
#   primary=auth-guard (SECURITY, tier 2),
#   secondary=[contract-risk-analyzer (LEGAL, tier 2), risk-evaluator (FINANCE, tier 2)],
#   reasoning="Task type: security_review | Complexity: high | Domain: security"
# )
```

### Step 3: Execute with Selected Models

```python
models = router.get_api_models(selection)
# Result: ["neurometric/auth-guard", "neurometric/contract-risk-analyzer", "neurometric/risk-evaluator"]
```

## Integration with Skill Chains

### Before (old way)

```python
# Every skill used the same model
neuro_harness.py --task "review code" --model "neurometric/clawpack"
```

### After (new way)

```python
# Model router selects optimal models
from model_router import ModelRouter

router = ModelRouter()
context = router.analyze_task(task, skills)
selection = router.select_models(context)

# Pass selected models to NEURO
neuro_harness.py --task "review code" --models ",".join(router.get_api_models(selection))
```

## Task Type → Model Category Mapping

| Task Type | Primary Categories | Secondary Categories |
|-----------|-------------------|---------------------|
| code_review | CODE, SECURITY | — |
| refactoring | CODE | — |
| debugging | CODE | — |
| security_review | SECURITY | LEGAL, FINANCE |
| architecture | GENERAL, CODE | DOCUMENT |
| sprint_planning | OPERATIONS, HR | — |
| documentation | DOCUMENT | CODE |
| data_analysis | DATA | — |
| financial_analysis | FINANCE | DATA |
| legal_review | LEGAL | SECURITY |
| performance | CODE, DATA | — |
| pr_review | CODE, SECURITY | — |

## Usage Examples

### Example 1: Code Review

```bash
python .opencode/skills/model-router/scripts/model_router.py \
    --task "Review the Monte Carlo convergence algorithm for performance issues" \
    --skills neuro code-hardener lint-fixer
```

Output:
```
Primary: ClawPack Coding (code, tier 2)
Secondary: Anomaly Sense (data, tier 2), Performance (code, tier 2)
```

### Example 2: Security Audit

```bash
python .opencode/skills/model-router/scripts/model_router.py \
    --task "Audit the authentication system for vulnerabilities" \
    --skills security code-hardener
```

Output:
```
Primary: Auth Guard (security, tier 2)
Secondary: Policy Check (security, tier 1), Contract Risk Analyzer (legal, tier 2)
```

### Example 3: Financial Analysis

```bash
python .opencode/skills/model-router/scripts/model_router.py \
    --task "Analyze the portfolio risk using Value at Risk methodology" \
    --skills quantum data
```

Output:
```
Primary: Risk Evaluator (finance, tier 2)
Secondary: Cash Flow Ref (finance, tier 2), Anomaly Sense (data, tier 2)
```

## API Usage

```python
from model_router import ModelRouter

router = ModelRouter()

# Analyze and select
context = router.analyze_task("Fix the numpy bool_ serialization bug", ["debugging", "python"])
selection = router.select_models(context)

# Get models for NEURO API
api_models = router.get_api_models(selection)
print(f"Models to use: {api_models}")

# Serialize for JSON
selection_dict = router.to_dict(selection)
```

## Self-Evolution

After every model selection:
1. Log the selection to `evolution/model_routing_log.jsonl`
2. Track which models were actually used
3. Measure effectiveness (did the selection improve outcomes?)
4. Update routing weights based on results

## Chaining

This skill chains with:
- **neuro**: Receives the selected models for API calls
- **code-hardener**: Uses code-specific models for hardening
- **lint-fixer**: Uses code-style models for linting
- **exhaustive-crosscheck**: Uses multi-model analysis for verification

## References

- NEURO API: https://api.neurometric.ai/v1/models
- Model Registry: `.opencode/skills/model-router/scripts/model_registry.py`
- Model Router: `.opencode/skills/model-router/scripts/model_router.py`

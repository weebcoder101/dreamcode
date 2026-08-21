---
name: onboarding
description: "Project onboarding and orientation. Use when first exploring the codebase, setting up the development environment, or understanding the project architecture."
chains_with:
  - automated-learning
---

# Onboarding Skill — Get Your Bearings Fast

## First Things First

When entering a new session on this project:

### 1. Read the Project Context
```bash
# Read the top-level project files
head -50 README.md 2>/dev/null
head -100 AGENTS.md 2>/dev/null

# Understand the directory structure
ls -la src/ 2>/dev/null
```

### 2. Check Current State
```bash
git log --oneline -5
git status
git branch
```

### 3. Understand the Architecture

**Project-Q** is a quantum-classical hybrid risk engine:

```
Data Pipeline → GARCH → PIT → Copula → MC Simulation → Risk Metrics → Backtesting
                                    ↓
                              Quantum POC (QAE/QAOA)
```

### 4. Key Files

| File | Purpose |
|------|---------|
| `src/project_q/dashboard/api_server.py` | Flask API server (all endpoints) |
| `src/project_q/quantum/` | Quantum primitives |
| `src/project_q/copula/` | Vine Copula models |
| `src/project_q/volatility/` | GARCH models |
| `src/project_q/simulation/` | Monte Carlo engine |
| `frontend/src/` | React frontend |
| `tests/` | Test suite |
| `outputs/` | Generated artifacts |
| `docker-compose.yml` | Docker setup |

### 5. Key Commands

```bash
# Build
pip install -e ".[dev]"

# Run API server
python -m src.project_q.dashboard.api_server

# Run tests
pytest tests/ -x -q

# Lint
ruff check src/

# Type check
mypy src/

# Docker
docker compose up -d
```

### 6. Check Long-Term Memory
Use Pieces LTM for historical context:
- `pieces_search_memory` — past decisions, discussions
- `pieces_workstream_events_full_text_search` — recent code work
- `pieces_annotations_full_text_search` — summaries, notes

## Navigation Cheatsheet

```
src/project_q/
  dashboard/           # API server + routes
    api_server.py      # Main Flask app (2492 lines)
  risk/                # Risk computation
    metrics.py         # VaR/ES calculation
    risk_engine.py     # Scenario to risk mapping
  copula/              # Vine copula
    fitting.py         # Copula fitting
    simulation.py      # Copula sampling
    regimes.py         # Regime-conditioned copula
  volatility/          # GARCH
    garch_estimator.py # GARCH model fitting
    regime_detection.py # Volatility regime detection
  quantum/             # Quantum POC
    circuits.py        # Quantum circuit definitions
    models/risk/       # QAE estimators
  simulation/          # Monte Carlo
    monte_carlo.py     # MC engine
    performance_optimiser.py # Bottleneck analysis
```

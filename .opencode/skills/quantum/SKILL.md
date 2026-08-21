---
name: quantum
description: "Quantum computing POC standards for QAE, QAOA, and hybrid quantum-classical algorithms. Use for quantum circuit design, simulator benchmarking, and honest reporting of quantum results."
chains_with:
  - performance
  - quality
---

# Quantum POC Skill — Honest Simulation, Clear Caveats

## Mandate

Every quantum result MUST be labeled as simulator-only. No claims of quantum advantage without fault-tolerant hardware evidence.

## Core Truths to Embed in Every Output

1. **Simulator only**: All quantum results are from classical CPU simulation (AerSimulator)
2. **No quantum advantage**: Quadratic speedup is theoretical — requires fault-tolerant hardware
3. **Small scale**: Current circuits limited to 3 assets, 16 qubits due to simulator constraints
4. **Noise-free**: Simulated circuits assume perfect gates and zero decoherence

## Quantum Primitives (Project-Q)

### QAE — Quantum Amplitude Estimation (Primary)
- **Purpose**: Estimate tail probability P(return ≤ -VaR)
- **Speedup**: Theoretical quadratic (O(1/ε) vs O(1/ε²) classical)
- **Provable**: YES — rigorous lower bound (Brassard et al. 2002)
- **Hardware needs**: Fault-tolerant, ~1,000+ logical qubits
- **Code**: `src/project_q/quantum/models/risk/qae_estimator.py`

### IQAE — Iterative QAE (Practical)
- **Purpose**: Same as QAE but with shallower circuits
- **Speedup**: Near-quadratic (O(log(1/ε)/ε))
- **Advantage**: Shallow circuits, no controlled-Grover chains
- **Code**: `src/project_q/quantum/models/risk/iqae.py`

### QAOA — Quantum Approximate Optimization (Exploratory)
- **Purpose**: Portfolio optimization (QUBO encoding)
- **Speedup**: NONE proven — heuristic algorithm
- **Status**: Exploratory POC, 4 assets, not in UI
- **Code**: `outputs/quantum/qaoa_portfolio_results.json`

## Benchmark Protocol

```bash
# Run QAE vs Classical benchmark
python scripts/benchmark_qae_vs_classical.py --synthetic

# Run with real data
python scripts/benchmark_qae_vs_classical.py --assets SPY QQQ BTC-USD
```

### Output Schema
```json
{
  "metadata": {
    "assets": ["SPY", "QQQ", "BTC-USD"],
    "simulator_only": true
  },
  "classical_mc": {
    "var": 20690.48,
    "es": 27171.79,
    "n_samples": 100000
  },
  "qae_fast_backend": {
    "qae_var": 0.03806,
    "runtime_seconds": 0.002,
    "simulator_only": true
  },
  "qae_aer_backend": {
    "qae_var": 0.03806,
    "runtime_seconds": 8.873,
    "circuit_depth": 34,
    "simulator_only": true
  },
  "disclaimer": "All results are from classical QPU simulation..."
}
```

## Reporting Standards

### Do Say
- "Theoretical quadratic speedup for QAE"
- "Simulator validates algorithm correctness"
- "Wasserstein distance = 0.0001 — distributions match"
- "Pipeline ready for fault-tolerant hardware"
- "Circuit compiles at 16 qubits, depth 18"

### Don't Say
- "Quantum advantage demonstrated"
- "Faster than classical" (runtime comparison is simulator overhead)
- "We ran on quantum hardware"
- "Production-ready quantum risk engine"
- "Beats classical models at [anything]"

## Output Files
```
outputs/quantum/
  summary.json              — QAE circuit metadata
  comparison.json           — Quantum vs classical distribution comparison
  benchmarks.json           — Runtime comparison
  circuit.json              — Circuit diagram data
  qubit_states.json         — Basis state probabilities
  aer_qae_results.json      — AerSimulator QAE results
  benchmark_results.json    — Full benchmark comparison
  qaoa_portfolio_results.json — QAOA POC results
```

## Known Caveats
- 3-asset limit (qubit budget: 6 state qubits = 64 bins)
- AerSimulator at 17 qubits is near practical limit for classical simulation
- QAOA results not hooked to UI
- No entanglement or interference effects beyond QAE

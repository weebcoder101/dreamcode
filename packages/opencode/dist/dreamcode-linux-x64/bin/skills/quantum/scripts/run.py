#!/usr/bin/env python3
"""Quantum computing analysis harness — analyzes prompts for quantum algorithms, error correction, and quantum-classical hybrid patterns."""

import json
import re
import sys
from pathlib import Path

QUANTUM_PATTERNS = {
    "algorithms": ["grover", "shor", "qaoa", "qae", "vqe", "qpe", "amplitude amplification", "quantum fourier"],
    "gates": ["hadamard", "cnot", "toffoli", "pauli", "swap", "phase", "rx", "ry", "rz", "t gate"],
    "error_correction": ["error correction", "surface code", "stabilizer", "syndrome", "decoherence", "fidelity"],
    "hardware": ["qubit", "superconducting", "trap", "photonic", "topological", "nisq", "fault tolerant"],
    "simulation": ["simulator", "qiskit", "cirq", "pennylane", "qsharp", "quantum simulator"],
    "hybrid": ["variational", "quantum-classical", "vqe", "qaoa", "parameter shift", "ansatz"],
    "applications": ["optimization", "chemistry", "material", "machine learning", "cryptography", "sensor"],
    "complexity": ["quantum advantage", "speedup", "complexity", "polynomial", "exponential", "superposition"],
    "noise": ["noise", "measurement error", "gate error", "t1", "t2", "relaxation", "dephasing"],
    "circuits": ["circuit", "depth", "width", "entanglement", "teleportation", "bell state", "ghz"],
}

QUANTUM_RECOMMENDATIONS = {
    "algorithms": "Start with proven algorithms (QAOA, VQE). Understand resource requirements before implementation.",
    "gates": "Optimize gate count. Use native gate sets. Minimize swap overhead in nearest-neighbor architectures.",
    "error_correction": "Use surface codes for fault tolerance. Error correction overhead is significant — plan accordingly.",
    "hardware": "Model noise characteristics of target hardware. Consider qubit connectivity constraints in algorithm design.",
    "simulation": "Use simulators for small-scale validation. Test on real hardware only after thorough simulation.",
    "hybrid": "Classical optimizers matter as much as quantum circuits. Use COBYLA or SPSA for noisy VQE.",
    "applications": "Match algorithm to problem structure. Not all problems benefit from quantum speedup.",
    "complexity": "Quantum advantage requires specific problem structure. Profile classical alternatives first.",
    "noise": "Model noise in simulations. Use error mitigation techniques (readout error mitigation, zero-noise extrapolation).",
    "circuits": "Minimize circuit depth for NISQ devices. Use circuit optimization passes. Measure in computational basis.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    recommendations = []

    for category, keywords in QUANTUM_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["quantum computing review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in QUANTUM_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": QUANTUM_RECOMMENDATIONS[cat]})

    return {
        "analysis_type": "quantum",
        "findings_count": len(findings),
        "findings": findings,
        "recommendations": recommendations,
        "prompt_length": len(prompt),
    }


def main():
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    prompt = read_prompt(prompt_file) if prompt_file else ""
    if not prompt:
        print(json.dumps({"status": "skipped", "reason": "No prompt provided"}))
        sys.exit(0)

    result = analyze_prompt(prompt)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

---
name: quantum-smart
description: "Trained quantum-coding harness patterns distilled from a QLoRA fine-tune of Qwen2.5-Coder-7B-Instruct on Qiskit/QGSS2026 lab corpora with execution-verified self-play. Use for bell states, grover, vqe, qnn, transpile, noise, qiskit, pennylane circuit coding — ALWAYS verify quantum code by execution."
chains_with:
  - python
  - performance
---

# Quantum-Smart Harness — Execution-Verified Qiskit Patterns

Distilled from the trained adapter (`demonslayeron/quantum-harness-sft-checkpoint`: SFT 3 epochs on 1892 examples — QGSS2026 quantum labs + harness logic — then ORPO on execution-verified preference pairs). Every pattern below **ran and passed** on qiskit 2.4.1 + qiskit-aer.

## Mandate (the #1 trained lesson)

**Never ship quantum code you have not executed.** Every circuit answer must be run on `AerSimulator` and the measurement output reported. The self-play loop that produced the trained behavior:

```python
# dream-loop verification pattern: generate -> execute -> keep only passing code
import subprocess, sys, re
def execute_code(code, timeout=30):
    code = re.sub(r"```python\n?", "", code)
    code = re.sub(r"```", "", code)
    with open("/tmp/_qc.py", "w") as f:
        f.write(code)
    try:
        r = subprocess.run([sys.executable, "/tmp/_qc.py"],
                           capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, r.stdout[:400], r.stderr.splitlines()[-1][:200] if r.stderr else ""
    except Exception:
        return False, "", "exception"
```

## Verified Pattern Library (all PASS on qiskit 2.4.1)

### GHZ state (n qubits)
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
qc = QuantumCircuit(5)
qc.h(0)
for i in range(4):
    qc.cx(i, i + 1)
qc.measure_all()
counts = AerSimulator().run(qc, shots=1024).result().get_counts()
assert set(counts) <= {"00000", "11111"}
print(counts)
```

### CNOT ladder entanglement
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
qc = QuantumCircuit(4)
qc.h(0)
for i in range(3):
    qc.cx(i, i + 1)
qc.measure_all()
counts = AerSimulator().run(qc, shots=1024).result().get_counts()
assert set(counts) <= {"0000", "1111"}
print(counts)
```

### Grover search (3 qubits, oracle for |101>)
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def grover_oracle(n, target):
    qc = QuantumCircuit(n)
    for i, b in enumerate(reversed(bin(target)[2:].zfill(n))):
        if b == "0":
            qc.x(i)
    qc.h(n - 1); qc.mcx(list(range(n - 1)), n - 1); qc.h(n - 1)
    for i, b in enumerate(reversed(bin(target)[2:].zfill(n))):
        if b == "0":
            qc.x(i)
    return qc

def diffuser(n):
    qc = QuantumCircuit(n)
    qc.h(range(n)); qc.x(range(n))
    qc.h(n - 1); qc.mcx(list(range(n - 1)), n - 1); qc.h(n - 1)
    qc.x(range(n)); qc.h(range(n))
    return qc

qc = QuantumCircuit(3, 3)
qc.h(range(3))
for _ in range(int(np.floor(np.pi / 4 * np.sqrt(8)))):
    qc.compose(grover_oracle(3, 5), inplace=True)
    qc.compose(diffuser(3), inplace=True)
qc.measure(range(3), range(3))
counts = AerSimulator().run(qc, shots=1024).result().get_counts()
print("Grover |101>:", counts)  # target dominates (~94%)
```

### QFT (3 qubits)
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def qft(n):
    qc = QuantumCircuit(n)
    for j in range(n):
        qc.h(j)
        for k in range(j + 1, n):
            qc.cp(np.pi / 2 ** (k - j), k, j)
    for i in range(n // 2):
        qc.swap(i, n - 1 - i)
    return qc

qc = QuantumCircuit(3)
qc.x(0)
qc.compose(qft(3), inplace=True)
qc.measure_all()
print(AerSimulator().run(qc, shots=1024).result().get_counts())
```

### Quantum teleportation (Qiskit 2.x style)
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
qc = QuantumCircuit(3, 3)
qc.x(0)                      # teleport |1>
qc.h(1); qc.cx(1, 2)         # Bell pair
qc.cx(0, 1); qc.h(0)
qc.measure(0, 0); qc.measure(1, 1)
with qc.if_test((1, 1)):     # 2.x: c_if is gone — use if_test
    qc.x(2)
with qc.if_test((0, 1)):
    qc.z(2)
qc.measure(2, 2)
counts = AerSimulator().run(qc, shots=1024).result().get_counts()
print(counts)  # classical bits 0,1 are the Bell measurements; qubit 2 == |1>
```

### Amplitude encoding
```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np
v = np.array([1, 0, 1, 0], dtype=float)
v = v / np.linalg.norm(v)
qc = QuantumCircuit(2)
qc.initialize(v, [0, 1])
qc.measure_all()
print(AerSimulator().run(qc, shots=4096).result().get_counts())  # ~equal |00> and |10>
```

### VQE for H2 (measurement-based expectation, COBYLA)
```python
from qiskit.quantum_info import SparsePauliOp
from qiskit.circuit.library import EfficientSU2
from qiskit_aer import AerSimulator
from scipy.optimize import minimize
import numpy as np

H = SparsePauliOp.from_list([("II", -1.0523), ("IZ", 0.3979), ("ZI", -0.3979),
                             ("ZZ", -0.0112), ("XX", 0.1809)])
ansatz = EfficientSU2(2, reps=2)
sim = AerSimulator()

def energy(params):
    qc = ansatz.assign_parameters(params).decompose()  # MUST decompose for Aer
    qc.measure_all()
    counts = sim.run(qc, shots=4096).result().get_counts()
    e = 0.0
    for bs, n in counts.items():
        p = n / 4096
        for lbl, c in H.to_list():
            v = 1.0
            for i, pa in enumerate(reversed(lbl)):
                if pa == "Z":
                    v *= 1 - 2 * int(bs[i])
            e += c.real * v * p   # SparsePauliOp coeffs are complex — use .real
    return e

r = minimize(energy, np.random.uniform(0, 2 * np.pi, ansatz.num_parameters), method="COBYLA")
print(f"VQE H2: {r.fun:.4f} Ha (exact -1.8572)")
```

## Qiskit 2.x Gotchas (learned the hard way)

1. **`c_if` is gone** — use `with qc.if_test((classical_bit, 1)): qc.x(q)`.
2. **`SparsePauliOp.to_list()` coefficients are `complex`** — call `.real` before feeding scipy (`TypeError: '<' not supported between instances of 'complex' and 'float'`).
3. **Parametrized circuits (EfficientSU2 etc.) must be `.decompose()`d before `AerSimulator.run`** — else `AerError: unknown instruction`.
4. `EfficientSU2` class is deprecated as of Qiskit 2.1 (prefer `qiskit.circuit.library.efficient_su2`); the class still works.
5. Standalone script execution needs **all imports inside the script** — notebooks silently mask missing imports (the 32-solution dream loop: only 5 passed standalone because of this).
6. Qiskit bitstrings are little-endian: `counts` keys index qubit 0 as the LSB.

## Provenance

- Training corpus: `demonslayeron/quantum-harness-training` (QGSS2026 labs: gates, superposition, entanglement, amplitude encoding, noise; plus harness logic: Dream Protocol, gate rules, Kaggle/T4 constraints, RE methodology, taste system, sensor gate).
- Trained adapter: `demonslayeron/quantum-harness-sft-checkpoint` (r=16, alpha=32, 7 target modules, 3 epochs, val loss ~0.10-0.17).
- Self-play: 8 seed tasks x 4 samples, execution-verified; ORPO on the verified preference pairs.
- Runtime lesson: on T4 (sm_75) use fp16 only (no bf16), LoRA master weights fp32 with the fp16 GradScaler, `adamw_torch`.

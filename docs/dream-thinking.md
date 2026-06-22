# Dream Thinking — The 6-Phase Engine

Dream Thinking is DreamCode's core differentiator — a structured 6-phase cognitive process that mimics human problem-solving.

## Overview

```
Raw Input → RESEARCH → GROUND → REFLECT → PROPOSE → BUILD → ACT → Output
               ↓         ↓        ↓          ↓       ↓      ↓
          Gather    Analyze  Evaluate   Generate  Execute  Deliver
          context   facts    options    solutions actions  results
```

## The 6 Phases

### 1. RESEARCH
Gather information from all available sources:
- File system scanning
- Git history analysis
- Web search (if NEURO is enabled)
- LTM recall (Pieces integration)
- Codebase structure analysis

**Trigger**: Any non-trivial request

### 2. GROUND
Analyze gathered facts against context:
- Project structure and conventions
- Existing code patterns
- Configuration and constraints
- Dependency relationships
- Risk assessment

**Trigger**: Research complete

### 3. REFLECT
Evaluate options and alternatives:
- Multiple solution paths
- Trade-off analysis
- Risk/reward scoring
- Prior art review
- Edge case identification

**Trigger**: Grounding complete or multiple viable paths found

### 4. PROPOSE
Generate concrete solutions:
- Implementation plans
- Code generation
- Refactoring strategies
- Testing approaches
- Documentation updates

**Trigger**: Reflection complete

### 5. BUILD
Execute the chosen solution:
- Write/modify code
- Run commands
- Create/move files
- Execute tests
- Apply lints

**Trigger**: Proposal approved

### 6. ACT
Deliver and document:
- Present results
- Update memory
- Score outcomes
- Suggest next steps
- Trigger follow-up actions

**Trigger**: Build complete

## DREAM_INNOVATION Mode

When the `breakthrough-overdrive-innovation` skill is in the chain, Dream Thinking enters **DREAM_INNOVATION** mode:

- **All 6 phases** are mandatory (no skipping)
- **Multi-perspective analysis** with 3-5 specialists
- **Scoring enforcement** is stricter
- **Documentation** is required
- **LTM persistence** is guaranteed

## Configuration

In `~/.config/dreamcode/config.yaml`:
```yaml
dream_mode: true          # Enable/disable dream thinking
model_router: true         # Enable domain-specific model routing
scoring: true              # Enable scoring enforcement
```

## Related

- [Skills Reference](skills.md) — The 37 skills powering each phase
- [Sensor Gate](sensor-gate.md) — Determines which mode to use
- [Scoring & Enforcement](scoring.md) — Scores each phase outcome

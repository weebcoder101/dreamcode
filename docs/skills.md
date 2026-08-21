# Skills Reference — 36 Native Skills

DreamCode has 36 native skills organized in a dynamic dependency graph. Each skill is a TypeScript tool, not an external script.

## Skill Categories

### META (12) — Runtime, orchestration, and cross-cutting concerns

| Skill | Description | Activation | Dependencies |
|-------|-------------|------------|--------------|
| `context-compactor` | Compresses conversation history to manage context window | Every user turn | — |
| `exhaustive-crosscheck` | Validates completeness of analysis across all dimensions | High-complexity tasks | `quality`, `testing` |
| `neuro` | Routes requests to 120+ NEURO models for domain-specific analysis | Always when NEURO_API_KEY is set | `model-router` |
| `model-router` | Selects optimal model based on task domain | Every request with model_router enabled | — |
| `code-hardener` | Applies defensive coding patterns and error handling | Production code changes | `testing`, `quality` |
| `lint-fixer` | Fixes lint errors and applies code style | Always present in chains | `code-hardener` |
| `pieces-ltm` | Integrates with Pieces for long-term memory recall | Always present in chains | `automated-learning` |
| `automated-learning` | Extracts learnings and patterns from sessions | Always present in chains | — |
| `chain-orchestrator` | Coordinates multi-skill execution chains | Multi-skill tasks | All skills in chain |
| `guardian-ai` | Risk assessment and approval for spawn decisions | Every sensor gate run | `chain-orchestrator` |
| `breakthrough-overdrive-innovation` | Activates DREAM_INNOVATION mode for complex tasks | Complex multi-domain tasks | All skills |
| `automation` | Manages scheduled and event-driven automations | Cron/event triggers | — |

### CORE (7) — Fundamental development work

| Skill | Description | Activation |
|-------|-------------|------------|
| `planning` | Creates structured implementation plans | Non-trivial tasks |
| `architecture` | Designs system architecture and module boundaries | Architecture/design tasks |
| `quality` | Code review, best practices, anti-pattern detection | Code changes |
| `security` | Security audit, vulnerability scanning | Security-related tasks, high-risk |
| `testing` | Test generation, test gap analysis | Code changes |
| `debugging` | Root cause analysis, fault isolation | Bug reports, errors |
| `performance` | Performance profiling, optimization | Performance-related tasks |

### LANGUAGE (4) — Language-specific tooling

| Skill | Description | Activation |
|-------|-------------|------------|
| `api` | API design, endpoint creation, SDK generation | API-related tasks |
| `python-best-practices` | Python-specific patterns, packaging, typing | Python code |
| `react` | React/JSX patterns, hooks, state management | React/JSX code |
| `frontend` | CSS, HTML, accessibility, responsive design | Frontend code |

### TOOL (3) — DevOps and version control

| Skill | Description | Activation |
|-------|-------------|------------|
| `git` | Git operations: commit, branch, rebase | Code changes |
| `git-feature-workflow` | Structured feature branch workflow | Feature development |
| `devops` | CI/CD, Docker, deployment, infrastructure | Deployment/infra tasks |

### SPECIALIZED (6) — Domain-specific analysis

| Skill | Description | Activation |
|-------|-------------|------------|
| `quantum-poc` | Quantum computing proof-of-concept | Quantum-related tasks |
| `quantum-smart` | Execution-verified Qiskit patterns (distilled from the trained harness adapter: GHZ, Grover, QFT, teleportation, VQE, encoding; always verify by execution) | Qiskit/PennyLane circuit coding |
| `data-science` | Data analysis, ML pipeline, visualization | Data tasks |
| `research` | Information gathering, literature review | Research requests |
| `deep-research` | Comprehensive multi-source investigation | Complex research |
| `documentation` | Code documentation, README, guides | Documentation tasks |

### SOFT SKILL (4) — Communication and process

| Skill | Description | Activation |
|-------|-------------|------------|
| `communication` | Structured communication, status reporting | Updates, communication |
| `product-thinking` | Feature design, user stories, requirements | Feature planning |
| `refactoring` | Code cleanup without behavior change | Refactoring tasks |
| `onboarding` | New developer onboarding, project setup | Onboarding tasks |

## Skill Chain Resolution

When a request arrives:

1. **Sensor Gate** classifies intent and selects skills from the 37-node graph
2. **Dependency resolution** ensures all transitive dependencies are included
3. **Chain executor** runs selected skills in dependency order
4. **Results merged** into a unified response

## Adding Custom Skills

Skills live in `~/.config/dreamcode/skills/` or `.dreamcode/skills/`. Each skill is a directory with:

```
skill-name/
  SKILL.md       # Required: skill definition
  scripts/       # Optional: supporting scripts
  config/        # Optional: skill-specific config
```

See [GUIDE.md](../GUIDE.md#skill-system) for the complete skill authoring guide.

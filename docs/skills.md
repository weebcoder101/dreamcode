# Skills Reference — 32 Native Skills

DreamCode ships **32 runtime skills** in `.opencode/skills/`, each a single TypeScript-backed skill definition. The dynamic dependency graph and sensor gate select and chain them per request.

This file is the **canonical catalog** generated from `.opencode/skills/*/SKILL.md` frontmatter. If a skill disappears, the count drops; if a new one is added, this list is updated. **The shipped count is 32, not 37** — older marketing copy that says "37-skill" or "120+ completely free" is stale and must be ignored.

## Skill Categories

### META (13) — Runtime, orchestration, and cross-cutting concerns

Mandatory or always-loaded skills.

| Skill | Description |
|-------|-------------|
| `context-compactor` | > |
| `exhaustive-crosscheck` | META-SKILL — mandatory entry point for EVERY non-trivial prompt. Decomposes prompt into 5 orthogonal cursors (Temporal, Source, Gesture, Topic, People), fires parallel Pieces LTM searches with pagination until confidence >= threshold, then orchestrates the full neuro (10 iter) -> code-hardener (5 iter) -> implementation -> lint-fixer (5 loop) chain. Self-evolutionary: after every run, analyzes outcomes and updates its own structure. Integrates, wraps, and supersedes neuro, code-hardener, and lint-fixer. |
| `neuro` | Mandatory external architectural and code-review harness for ANY non-trivial task including code changes, bug fixes, new features, refactors, API changes, data contract changes, performance optimizations, security fixes, architectural decisions, configuration changes, test modifications, integration work, debugging, analysis, planning, and implementation. Use when the user requests any modification, analysis, debugging, testing, integration, or planning work. Use for EVERY prompt that involves understanding or changing code, data, or configuration. When in doubt, ALWAYS use this skill. Skip only for trivial changes: typo fixes, formatting-only changes, one-line lint fixes, comment cleanup, simple unused import removal. |
| `model-router` | > |
| `code-hardener` | Mandatory second-stage logic filter and architectural hardening skill that runs after NEURO for ANY code change, bug fix, new feature, refactor, API change, data contract change, performance optimization, security fix, architectural decision, configuration change, test modification, integration work, debugging, analysis, planning, or implementation. Executes exactly 5 mandatory iterations. Validates NEURO recommendations against repo truth, calls NEURO with filtered critique, then emits the only implementation plan opencode may follow. Use after any neuro skill usage. Use when code is about to be edited. Use for every non-trivial code modification. |
| `lint-fixer` | Mandatory post-implementation lint and type-checking skill that runs after ANY code change, bug fix, new feature, refactor, API change, or configuration modification. Ensures all ruff lint errors, mypy type errors, and ESLint issues are resolved. Use after every implementation that modifies source files. Use when code has been edited. Use for every response where file edits were made. |
| `pieces-ltm` | > |
| `automated-learning` | Self-evolution skill — captures what worked, what failed, and what to change after every non-trivial run. Produces routing patches, registry hygiene checks, and paste-ready Learning Notes for run_log.jsonl. Mandatory post-run step for STANDARD, DEEP, and DREAM_INNOVATION modes. |
| `chain-orchestrator` | > |
| `guardian-ai` | Codex-inspired Guardian AI — NEURO-powered safety supervisor that reviews agent actions on EVERY prompt before execution. Uses NEURO API as its brain. Validates code changes, catches security issues, prevents destructive operations. MANDATORY — cannot be skipped. |
| `breakthrough-overdrive-innovation` | DEFAULT THINKING MODE — not a feature, but how the agent operates. Every task gets innovation-overdrive thinking: research, ground, reflect on contradictions, propose, then build. This is the agent's identity, not a command. Integrates MiMo-Code's 6-phase memory consolidation. |
| `automation` | Trigger-driven automation definitions and runner management. Use when creating, running, or managing skill-based automation pipelines. |
| `effect` | Work with Effect v4 / effect-smol TypeScript code in this repo |

### CORE (7) — Fundamental development work

Pulled in for any non-trivial code task.

| Skill | Description |
|-------|-------------|
| `planning` | Systematic project planning and task decomposition. Use when starting a new feature, refactoring, debugging, or any multi-step task. Provides structured thinking frameworks, spec-first analysis, and staged implementation plans. |
| `architecture` | Architectural design, system patterns, and dependency management. Use when designing new modules, refactoring existing systems, or making architectural decisions. Covers layering, coupling, cohesion, and design patterns. |
| `debugging` | Systematic debugging methodology. Use when encountering unexpected behavior, test failures, or production issues. Covers reproduce-isolate-fix-verify cycle. |
| `performance` | Performance analysis, profiling, and optimization. Use when optimizing slow code, reducing memory, or scaling to larger datasets. Covers profiling, bottleneck identification, and optimization patterns. |
| `security` | Security review and vulnerability analysis. Use when handling sensitive data, authentication, authorization, input validation, or any security-relevant code. Based on OWASP Top 10 patterns. |
| `testing` | Testing strategy, test writing, and coverage standards. Use when writing or reviewing tests. Covers unit, integration, property-based, and benchmark tests. |
| `refactoring` | Safe refactoring methodology. Use when restructuring existing code without changing behavior. Covers patterns for incremental improvement, testing during refactors, and risk management. |

### LANGUAGE (4) — Language / frontend tooling

Language- or surface-specific guidance.

| Skill | Description |
|-------|-------------|
| `python` | Python development standards, typing, imports, and project structure. Use for all Python code in the project. Covers modern Python tooling with ruff, mypy, pytest. |
| `frontend` | Frontend development standards for React, TailwindCSS, and Vite. Use for UI components, pages, styling, and frontend architecture. Covers component patterns, state management, and performance. |
| `api` | API design patterns, REST conventions, and endpoint standards. Use when creating or modifying API endpoints. Covers routing, request/response patterns, error handling, and versioning. |
| `data` | Data science and statistical analysis best practices. Use for data analysis, statistical modeling, visualization, and numerical computation. Covers pandas/numpy patterns, statistical methodology, and reproducibility. |

### TOOL (2) — DevOps and version control

Day-to-day engineering operations.

| Skill | Description |
|-------|-------------|
| `git` | Git operations, branching strategy, commit conventions, and PR workflow. Use for all git operations. Enforces clean history and conventional commits. |
| `devops` | Docker, CI/CD, deployment, and infrastructure management. Use for container builds, CI pipeline changes, deployment configurations, and environment setup. |

### SPECIALIZED (3) — Domain-specific analysis

Only activated when the request matches.

| Skill | Description |
|-------|-------------|
| `quantum` | Quantum computing POC standards for QAE, QAOA, and hybrid quantum-classical algorithms. Use for quantum circuit design, simulator benchmarking, and honest reporting of quantum results. |
| `research` | Systematic research methodology for investigating topics, exploring codebases, and gathering information. Use when researching unknown topics, exploring new code, or gathering evidence. |
| `youtube-transcript` | Fetch, analyze, and summarize YouTube video transcripts. Use when the user wants to extract transcript from a YouTube video, summarize a video's content, or use video transcripts as coding context. |

### SOFT SKILL (3) — Communication and process

Framing and human-facing concerns.

| Skill | Description |
|-------|-------------|
| `communication` | Communication standards for explaining technical concepts to different audiences. Use when presenting results, writing explanations, or preparing presentations. |
| `product` | Product-oriented thinking for understanding user needs, prioritizing features, and designing solutions. Use when the task involves product decisions, feature prioritization, or understanding user impact. |
| `onboarding` | Project onboarding and orientation. Use when first exploring the codebase, setting up the development environment, or understanding the project architecture. |

## Skill Chain Resolution

When a request arrives:

1. **Sensor Gate** classifies intent and selects skills from the 32-node graph.
2. **Dependency resolution** ensures all transitive dependencies are included.
3. **Chain executor** runs selected skills in dependency order.
4. **Results merged** into a unified response.

## NEURO — external review harness (not a free model catalogue)

`neuro` is a *capability*, not a model. The earlier `docs/neuro.md` described a marketing-only catalog ("120+ completely free") that does not reflect how `guardian-ai` and `model-router` actually invoke NEURO today. NEURO is now service-controlled and billed; the catalog referenced in older docs is **stale and removed**.

## Adding Custom Skills

Skills live in `~/.config/dreamcode/skills/` or `.dreamcode/skills/`. Each skill is a directory with:

```
skill-name/
  SKILL.md       # Required: skill definition (name + description frontmatter)
  scripts/       # Optional: supporting scripts
  config/        # Optional: skill-specific config
```

See [GUIDE.md](../GUIDE.md) for the complete skill authoring guide.

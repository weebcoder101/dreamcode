# AGENTS.md — DreamCode Orchestrator

DreamCode is a fork of opencode with a 38-skill orchestration system, sensor gate, and Pieces LTM integration.

---

## 1. Sensor Automation (5-stage mandatory gate)

Every non-trivial prompt MUST complete these stages before responding:

### Stage 0: Chain Classification
Classify the prompt and determine which skill chains fire.

### Stage 1: Intent Classification
```
[SENSOR] Intent Classification
- intent: <what the user wants>
- domain_tags: <3-8 tags>
- risk_level: <low|medium|high>
- requires_tools: <none|files|git|web|calendar|memory>
- deliverable_type: <answer|plan|patch|doc|automation_run|multi>
- is_social_greeting: <true|false>
```

### Stage 2: Skill Resolution
```
[SENSOR] Skill Resolution
- primary: <skill_id>
- supports: <skill_1>, <skill_2>
- automation: <automation_name or none>
- mode: <TRIVIAL|STANDARD|DEEP|DREAM_INNOVATION>
- chain: <full chain from Stage 0>
```

### Stage 3: Guardian AI Safety Review
```
[GUARDIAN] Safety Review
- decision: APPROVED | REJECTED | HUMAN_REQUIRED
- risk_level: <low|medium|high|critical>
- source: <rule_based_neuro_format_error | neuro_api>
```

### Stage 4: Skill Plan
```
Skill Plan:
- primary: <primary_skill>
- supports: <support_1>, <support_2>
- automation: <automation_to_run or none>
- mode: <TRIVIAL | STANDARD | DEEP | DREAM_INNOVATION>
- chain: <chain execution order>
```

---

## 2. Skill Registry (38 skills)

| # | Skill ID | Category | Description |
|---|----------|----------|-------------|
| 0 | `context-compactor` | META | Context compression before agent reads it |
| 1 | `exhaustive-crosscheck` | META | LTM cursor decomposition → NEURO → hardener → lint-fixer |
| 2 | `neuro` | META | External AI architecture review — 10 iterations |
| 3 | `code-hardener` | META | Logic filter and hardening — 5 iterations |
| 4 | `lint-fixer` | META | Post-implementation quality — 5 fix loops |
| 5 | `planning` | CORE | Structured project planning |
| 6 | `architecture` | CORE | System design, patterns |
| 7 | `quality` | CORE | Code quality enforcement |
| 8 | `security` | CORE | OWASP-based security review |
| 9 | `testing` | CORE | Test writing, coverage |
| 10 | `debugging` | CORE | Systematic fault isolation |
| 11 | `performance` | CORE | Profiling, optimization |
| 12 | `python` | LANGUAGE | Python 3.12+ standards |
| 13 | `frontend` | LANGUAGE | React, TailwindCSS, Vite |
| 14 | `react` | LANGUAGE | React hooks, patterns |
| 15 | `api` | LANGUAGE | REST conventions, Flask |
| 16 | `git` | TOOL | Branch strategy, commits |
| 17 | `devops` | TOOL | Docker, CI/CD |
| 18 | `quantum` | SPECIALIZED | QAE/QAOA standards |
| 19 | `data` | SPECIALIZED | Pandas/numpy patterns |
| 20 | `research` | SPECIALIZED | Codebase exploration |
| 21 | `documentation` | SPECIALIZED | Docstrings, README |
| 22 | `communication` | SOFT SKILL | Audience-appropriate explanation |
| 23 | `product` | SOFT SKILL | User needs, prioritization |
| 24 | `refactoring` | SOFT SKILL | Safe restructuring |
| 25 | `onboarding` | SOFT SKILL | Project orientation |
| 26 | `automation` | META | Trigger-driven skill pipelines |
| 27 | `automated-learning` | META | Self-evolution: routing patches, Learning Notes |
| 28 | `breakthrough-overdrive-innovation` | META | Dream-like reflection + innovation |
| 29 | `model-router` | META | 120+ NEURO models → task routing |
| 30 | `pieces-ltm` | META | Pieces LTM auto-persistence |
| 31 | `deep-research` | SPECIALIZED | Multi-step web research |
| 32 | `chain-orchestrator` | META | Chain execution manager |
| 33 | `guardian-ai` | META | Safety supervisor |
| 34 | `youtube-transcript` | SPECIALIZED | YouTube transcript extraction |
| 35 | `git-feature-workflow` | TOOL | Codex-style feature lifecycle |
| 36 | `scheduled-automations` | META | Cron-like job engine |
| 37 | `effect` | LANGUAGE | Effect-TS patterns |

---

## 3. Core Chain (always runs)

```
context-compactor → exhaustive-crosscheck → neuro → model-router →
code-hardener → lint-fixer → pieces-ltm → automated-learning
```

---

## 4. Safety & Constraints

### Never Do
- Never commit unless explicitly asked
- Never expose API keys, tokens, secrets
- Never run `git push --force` on shared branches
- Never fabricate test results or benchmark numbers

### Security Checklist (for any change)
- Does this touch auth, tokens, or secrets?
- Does this expose internal data through an API?
- Does this modify file permissions?
- Does this introduce a dependency that phones home?

---

## 5. Response Formatting

- No preamble. Do not start with "Here is what I found"
- No postamble. Do not end with "Let me know if you need anything else"
- One word answers are valid for yes/no questions
- Code references: `file_path:line_number`

---

## 6. Subagent Cost Optimization (IMPORTANT)

### ⚠️ Warning: Subagents inherit your parent model by default

If you are using a high-cost model (e.g., o1, claude-opus), every subagent spawn
will cost the same per-token rate. With 3-5 subagents per task, costs multiply
quickly.

### Recommendations

- **Use `/subagent` to set a cheaper model** for subagents (e.g., deepseek-v4-flash, mimo-v2.5)
- Low-cost models are perfectly adequate for code analysis, file reading, and research tasks
- The parent model handles synthesis and decision-making — subagents just need analysis capability
- On the first query of any session, you will see a prompt asking you to configure a cheaper subagent model

### How to set

```
/subagent deepseek/deepseek-v4-flash    — Set subagent model
/subagent off                           — Reset to parent model
```

### Why this matters

Each persona subagent sends ~200K+ tokens per call. With 3-5 concurrent subagents,
that's 600K-1M tokens per task round. At premium model rates, this can be
significantly more expensive than using a cheap model for subagent analysis tasks.

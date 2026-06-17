# DreamCode — Complete Infrastructure Guide

> **Read this to unlock 100% of DreamCode's potential.**
> This guide covers everything: architecture, skills, configuration, workflows, and advanced patterns.

---

## Table of Contents

1. [What DreamCode Actually Is](#1-what-dreamcode-actually-is)
2. [Architecture Overview](#2-architecture-overview)
3. [Installation & Setup](#3-installation--setup)
4. [Configuration Reference](#4-configuration-reference)
5. [The 37-Skill System](#5-the-37-skill-system)
6. [Sensor Gate — How Every Prompt Is Classified](#6-sensor-gate)
7. [Dream Thinking — The 6-Phase Engine](#7-dream-thinking)
8. [Scoring & Enforcement](#8-scoring--enforcement)
9. [Memory System (SQLite FTS5)](#9-memory-system)
10. [Model Router — 120+ Models](#10-model-router)
11. [Checkpoint & Recovery](#11-checkpoint--recovery)
12. [Sandbox Mode](#12-sandbox-mode)
13. [MCP Servers](#13-mcp-servers)
14. [VS Code Integration](#14-vs-code-integration)
15. [Antigravity IDE Integration](#15-antigravity-ide-integration)
16. [Skill Chains — How Skills Connect](#16-skill-chains)
17. [Automation & Cron Jobs](#17-automation--cron-jobs)
18. [Pieces LTM Integration](#18-pieces-ltm)
19. [NEURO API — External AI Review](#19-neuro-api)
20. [Troubleshooting](#20-troubleshooting)
21. [Power User Patterns](#21-power-user-patterns)

---

## 1. What DreamCode Actually Is

DreamCode is a **fork of opencode** with three major additions:

| System | What It Does | Where It Lives |
|--------|-------------|----------------|
| **MiMo-Code Memory** | SQLite FTS5 memory, dream prompts, actor system | `packages/opencode/src/memory/` |
| **37-Skill Graph** | Dynamic skill selection, model routing, scoring | `.opencode/skills/` |
| **Native TypeScript Tools** | Skills as first-class tools, not external scripts | `packages/opencode/src/tool/skill.ts` |

**The key insight**: Skills are TypeScript tools registered in the agent's tool registry. When the agent runs, the sensor gate classifies your prompt, selects skills from the 37-node graph, and executes them as native tool calls.

---

## 2. Architecture Overview

```
User Prompt
    ↓
┌─────────────────────────────────────────┐
│ SENSOR GATE (chain-orchestrator)        │
│  - Classify intent                      │
│  - Select skills from 37-node graph     │
│  - Determine chain execution order      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ DREAM THINKING (6 phases)               │
│  1. Research — what do I know?          │
│  2. Ground — what are constraints?      │
│  3. Reflect — contradictions?           │
│  4. Multi-perspective analysis          │
│  5. Propose — innovations with tests    │
│  6. Build — implement chosen approach   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ SKILL CHAIN EXECUTION                   │
│  core: context-compactor → exhaustive   │
│        → neuro → model-router →         │
│        code-hardener → lint-fixer →     │
│        pieces-ltm → automated-learning  │
│  + task-specific skills (security,      │
│    testing, debugging, etc.)            │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ SCORING + MEMORY CONSOLIDATION          │
│  - Record points for actions            │
│  - Persist to SQLite FTS5               │
│  - Checkpoint for recovery              │
└─────────────────────────────────────────┘
    ↓
Response
```

---

## 3. Installation & Setup

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/weebcoder101/dreamcode.git
cd dreamcode
bun install
bun run build
cd packages/opencode && npm install -g .
```

### Verify installation

```bash
dreamcode --version
```

### First run

```bash
cd <your-project>
dreamcode
```

DreamCode will:
1. Read `.opencode/` config from your project
2. Load the 37-skill graph
3. Initialize SQLite memory at `~/.local/share/dreamcode/`
4. Start the TUI

---

## 4. Configuration Reference

### Config location

```
~/.config/dreamcode/config.yaml
```

### Full config reference

```yaml
# ─── Core ───────────────────────────────────────
dream_mode: true          # Enable 6-phase dream thinking
scoring: true             # Enable scoring enforcement
model_router: true        # Enable 120+ model routing

# ─── Sandbox ───────────────────────────────────
sandbox: false            # Set to true to enable firejail isolation
                          # OFF by default — you must opt in

# ─── Models ────────────────────────────────────
models:
  default: "anthropic/claude-sonnet-4-20250514"
  dream: "anthropic/claude-sonnet-4-20250514"    # Model for dream thinking
  review: "anthropic/claude-sonnet-4-20250514"   # Model for code review

# ─── Skills ────────────────────────────────────
skills:
  auto_chain: true        # Automatically chain skills
  max_chain_length: 16    # Max skills in a chain
  scoring: true           # Track skill execution scores

# ─── Memory ────────────────────────────────────
memory:
  backend: "sqlite"       # SQLite FTS5 (default)
  max_entries: 10000      # Max memory entries
  reconcile_interval: 300 # Seconds between reconciliation

# ─── NEURO API ─────────────────────────────────
neuro:
  api_key: "${NEURO_API_KEY}"  # Set via env var
  base_url: "https://api.neurometric.ai/v1"
  max_iterations: 10      # Max NEURO review iterations

# ─── Pieces LTM ────────────────────────────────
pieces:
  enabled: true           # Enable Pieces long-term memory
  auto_persist: true      # Auto-persist after skill chains
```

### Project-level config

Create `.opencode/opencode.jsonc` in your project:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {},
  "permission": {},
  "mcp": {},
  "tools": {
    "github-triage": false
  }
}
```

---

## 5. The 37-Skill System

DreamCode has 37 skills organized in 6 categories:

### META (12) — Always available

| Skill | Purpose | Chains With |
|-------|---------|-------------|
| `context-compactor` | Compress context before agent reads it | All chains (Phase 0) |
| `exhaustive-crosscheck` | LTM cursor decomposition → NEURO → hardener | All non-trivial tasks |
| `neuro` | External AI architecture review (10 iterations) | code-hardener, lint-fixer |
| `model-router` | Route to optimal model for task | All chains |
| `code-hardener` | Logic filter, 5 iterations | lint-fixer |
| `lint-fixer` | Post-implementation quality, 5 loops | pieces-ltm |
| `pieces-ltm` | Auto-persist to Pieces LTM | automated-learning |
| `automated-learning` | Self-evolution, routing patches | All chains (final step) |
| `chain-orchestrator` | Validate dependencies, enforce order | All chains |
| `guardian-ai` | Safety supervisor, reviews before execution | All chains |
| `breakthrough-overdrive-innovation` | Dream-like reflection + innovation | neuro, code-hardener |
| `automation` | Trigger-driven skill pipelines | scheduled-automations |

### CORE (7) — Code changes

| Skill | When To Use |
|-------|-------------|
| `planning` | Multi-step tasks, feature planning |
| `architecture` | System design, pattern decisions |
| `quality` | Linting, type checking, coverage |
| `security` | Auth, secrets, OWASP patterns |
| `testing` | Test writing, coverage standards |
| `debugging` | Fault isolation, root cause |
| `performance` | Profiling, optimization |

### LANGUAGE (4) — Language-specific

| Skill | Language |
|-------|----------|
| `python` | Python 3.12+ |
| `frontend` | React, TailwindCSS, Vite |
| `react` | React hooks, components |
| `api` | REST, Flask patterns |

### TOOL (3) — Tooling

| Skill | Tool |
|-------|------|
| `git` | Branch strategy, commits |
| `git-feature-workflow` | start/pr/finish lifecycle |
| `devops` | Docker, CI/CD |

### SPECIALIZED (5) — Domain-specific

| Skill | Domain |
|-------|--------|
| `quantum` | QAE/QAOA, simulator benchmarking |
| `data` | Pandas, numpy, statistics |
| `research` | Codebase exploration |
| `deep-research` | Multi-step web research |
| `documentation` | Docstrings, README, API docs |

### SOFT SKILL (4) — Cross-cutting

| Skill | Purpose |
|-------|---------|
| `communication` | Audience-appropriate explanation |
| `product` | User needs, prioritization |
| `refactoring` | Safe restructuring |
| `onboarding` | Project orientation |

---

## 6. Sensor Gate

Every prompt passes through the sensor gate (`.opencode/skills/chain-orchestrator/scripts/sensor_gate.py`).

### How it works

```bash
python .opencode/skills/chain-orchestrator/scripts/sensor_gate.py --prompt "your prompt"
```

### Classification output

```
[SENSOR] Intent Classification
- intent: <what the user wants>
- domain_tags: <tags>
- risk_level: low|medium|high
- time_sensitivity: low|medium|high
- requires_tools: none|files|git|web
- deliverable_type: answer|plan|patch|doc|multi

[SENSOR] Skill Resolution
- primary: <skill_id>
- supports: <skill_1>, <skill_2>
- mode: TRIVIAL|STANDARD|DEEP|DREAM_INNOVATION

[GUARDIAN] Safety Review
- decision: APPROVED|REJECTED|HUMAN_REQUIRED
- risk_level: low|medium|high|critical
```

### Risk levels

| Level | Auto-Approve? | Action |
|-------|---------------|--------|
| `low` | Yes | Lint, comments, docs |
| `medium` | Yes (logged) | Features, refactors |
| `high` | No → Human | Auth, CI config |
| `critical` | No → Human | Secrets, destructive ops |

---

## 7. Dream Thinking

The 6-phase engine that runs on every non-trivial prompt:

### Phase 1: Research
- Search LTM for prior context
- Search codebase for relevant code
- Search web if needed

### Phase 2: Ground
- Identify constraints
- Check what must not break
- Verify assumptions

### Phase 3: Reflect
- Find contradictions in the codebase
- Identify non-obvious connections
- Challenge assumptions

### Phase 4: Multi-perspective
- Security perspective
- Performance perspective
- UX perspective
- Architecture perspective

### Phase 5: Propose
- 3 innovations with hypotheses
- Experiment plans
- Failure modes

### Phase 6: Build
- Choose ONE approach
- Implement it
- Verify it works

### When dream thinking activates

| Task Type | Dream Depth |
|-----------|-------------|
| Trivial (typo, one-line) | Skip |
| Standard (bug fix, feature) | Phases 1-4 |
| Deep (architecture, novel) | All 6 phases |
| Innovation ("think", "innovate") | All 6 + extra research |

---

## 8. Scoring & Enforcement

DreamCode tracks every action with points:

### Score events

| Event | Points | Trigger |
|-------|--------|---------|
| `sensor_gate_run` | +10 | Gate executed |
| `skill_executed` | +5 | Skill ran successfully |
| `chain_completed` | +15 | Full chain finished |
| `test_passed` | +10 | Tests pass |
| `lint_clean` | +5 | No lint errors |
| `pieces_persisted` | +5 | Memory saved |
| `sensor_gate_skipped` | -25 | Gate was skipped |
| `dream_skipped` | -30 | Dream thinking skipped |
| `guardian_rejected` | -50 | Safety check failed |

### Score file

```
evolution/agent_score.json
```

### View score

```bash
cat evolution/agent_score.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Score: {d[\"total\"]}')"
```

---

## 9. Memory System

DreamCode uses SQLite FTS5 for full-text search memory:

### How it works

1. Every skill chain result is persisted to SQLite
2. FTS5 enables fast full-text search across all memories
3. Memory reconciliation runs periodically to update indices

### Memory files

```
~/.local/share/dreamcode/memory.db    # SQLite database
.opencode/chain_log.jsonl             # Skill execution log
evolution/agent_score.json            # Scoring data
.opencode/checkpoints/store.json      # Session checkpoints
```

### Search memory

```bash
sqlite3 ~/.local/share/dreamcode/memory.db "SELECT * FROM memories WHERE memories MATCH 'your query' LIMIT 10"
```

### Memory reconciliation

The `reconcile-ts.ts` module walks your `.opencode/` directory, extracts tokens from all `.md` files, and builds a frequency index. This runs automatically every 5 minutes.

---

## 10. Model Router

DreamCode can route to 120+ specialized models via the NEURO API:

### How it works

1. The sensor gate classifies your prompt
2. The model router selects the best model for the task
3. The selected model processes the request
4. Results are combined

### Model selection by domain

| Domain | Model Type |
|--------|-----------|
| Code generation | Code-specialized models |
| Architecture review | Reasoning models |
| Security audit | Security-trained models |
| Documentation | Language models |
| Quantum | Quantum-specialized models |

### Configure models

```yaml
# ~/.config/dreamcode/config.yaml
models:
  default: "anthropic/claude-sonnet-4-20250514"
  dream: "anthropic/claude-sonnet-4-20250514"
  review: "anthropic/claude-sonnet-4-20250514"
```

---

## 11. Checkpoint & Recovery

DreamCode auto-saves session checkpoints:

### How it works

1. After every skill chain, a checkpoint is saved
2. Checkpoints include: files changed, skills executed, score
3. You can resume from any checkpoint

### Checkpoint file

```
.opencode/checkpoints/store.json
```

### Load checkpoint

```typescript
import { loadCheckpoint } from './packages/opencode/src/session/checkpoint-dreamcode'
const cp = loadCheckpoint()  // Latest checkpoint
console.log(cp.files_changed, cp.skills_executed, cp.score)
```

### Max checkpoints

50 checkpoints are kept (oldest auto-deleted).

---

## 12. Sandbox Mode

### Default: OFF

DreamCode runs **without sandbox by default**. This means:
- Full filesystem access
- Can run any command
- No isolation

### Enable sandbox

```bash
# Temporary (this session only)
export DREAMCODE_SANDBOX=on

# Permanent (add to config)
echo "sandbox: true" >> ~/.config/dreamcode/config.yaml
```

### What sandbox does

When enabled, commands run inside `firejail`:
- Filesystem isolation (only project dir accessible)
- Network isolation (no internet unless allowed)
- Process isolation (can't see other processes)

### Check sandbox status

```bash
dreamcode --sandbox-status
```

### ⚠️ Sandbox warning

When you enable sandbox, DreamCode will warn you:
- What isolation is active
- What access is restricted
- How to disable it

**You must explicitly acknowledge the warning before sandbox activates.**

---

## 13. MCP Servers

DreamCode supports MCP (Model Context Protocol) servers:

### Built-in servers

| Server | Purpose | Status |
|--------|---------|--------|
| `github` | GitHub API | Enabled |
| `filesystem` | File access | Enabled |
| `pieces-ltm` | Long-term memory | Enabled |
| `youtube-transcript` | Video transcripts | Enabled |
| `playwright` | Browser automation | Disabled |
| `supabase` | Database | Disabled |

### Configure MCP

Edit `.opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "github": { "enabled": true },
    "pieces-ltm": { "enabled": true },
    "playwright": { "enabled": false }
  }
}
```

### Add custom MCP server

```jsonc
{
  "mcp": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "API_KEY": "your-key" }
    }
  }
}
```

---

## 14. VS Code Integration

### Recommended extensions

Create `.vscode/extensions.json`:

```jsonc
{
  "recommendations": [
    "opencode.opencode-vscode",
    "ms-vscode.vscode-typescript-next",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-python.python",
    "ms-toolsai.jupyter"
  ]
}
```

### Settings

Create `.vscode/settings.json`:

```jsonc
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[python]": {
    "editor.defaultFormatter": "ms-python.black-formatter"
  },
  "files.exclude": {
    "**/.opencode/checkpoints": true,
    "**/evolution": true,
    "**/node_modules": true
  }
}
```

### Tasks

Create `.vscode/tasks.json`:

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "DreamCode: Build",
      "type": "shell",
      "command": "bun run build",
      "options": { "cwd": "${workspaceFolder}/packages/opencode" },
      "group": "build"
    },
    {
      "label": "DreamCode: Dev",
      "type": "shell",
      "command": "bun run dev",
      "options": { "cwd": "${workspaceFolder}" },
      "group": "build"
    },
    {
      "label": "DreamCode: Test",
      "type": "shell",
      "command": "bun test",
      "options": { "cwd": "${workspaceFolder}/packages/opencode" },
      "group": "test"
    },
    {
      "label": "DreamCode: Sensor Gate",
      "type": "shell",
      "command": "python .opencode/skills/chain-orchestrator/scripts/sensor_gate.py --prompt '${input:prompt}'",
      "problemMatcher": []
    }
  ],
  "inputs": [
    {
      "id": "prompt",
      "type": "promptString",
      "description": "Enter prompt for sensor gate"
    }
  ]
}
```

### Launch config

Create `.vscode/launch.json`:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "DreamCode: Debug",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "bun",
      "args": ["run", "--conditions=browser", "src/index.ts"],
      "cwd": "${workspaceFolder}/packages/opencode",
      "console": "integratedTerminal"
    }
  ]
}
```

### Keybindings

Create `.vscode/keybindings.json`:

```jsonc
[
  {
    "key": "ctrl+shift+d",
    "command": "workbench.action.terminal.sendSequence",
    "args": { "text": "dreamcode\n" }
  }
]
```

---

## 15. Antigravity IDE Integration

DreamCode is designed to work with Antigravity IDE:

### Setup

1. Install Antigravity IDE
2. Open your DreamCode project
3. Antigravity will auto-detect `.opencode/` config

### Antigravity-specific features

| Feature | How To Use |
|---------|-----------|
| Skill execution | Ctrl+Shift+P → "DreamCode: Run Skill" |
| Sensor gate | Ctrl+Shift+P → "DreamCode: Sensor Gate" |
| Dream thinking | Ctrl+Shift+P → "DreamCode: Dream" |
| Score view | Ctrl+Shift+P → "DreamCode: Show Score" |

### Antigravity config

Create `.antigravity/config.json`:

```jsonc
{
  "dreamcode": {
    "enabled": true,
    "sandbox": false,
    "dream_mode": true,
    "scoring": true,
    "model_router": true,
    "skills": {
      "auto_chain": true,
      "max_chain_length": 16
    }
  }
}
```

### Antigravity + DreamCode workflow

1. **Open project** in Antigravity
2. **Type prompt** in the agent panel
3. **Sensor gate** classifies intent automatically
4. **Dream thinking** analyzes the problem
5. **Skill chain** executes selected skills
6. **Scoring** records points
7. **Memory** persists results to LTM

---

## 16. Skill Chains

Skills are connected in chains. Here are the common patterns:

### Core chain (always runs)

```
context-compactor → exhaustive-crosscheck → neuro → model-router →
code-hardener → lint-fixer → pieces-ltm → automated-learning
```

### Bug fix chain

```
debugging → testing → quality
```

### Security chain

```
security → code-hardener → quality
```

### Feature chain

```
planning → architecture → code-hardener → testing → quality
```

### Research chain

```
deep-research → research → documentation
```

### Innovation chain

```
breakthrough-overdrive-innovation → neuro → code-hardener → lint-fixer
```

### How to trigger specific chains

| Prompt Pattern | Chain Triggered |
|---------------|-----------------|
| "fix the bug in..." | debugging → testing → quality |
| "add security to..." | security → code-hardener |
| "optimize the..." | performance → quality |
| "refactor the..." | refactoring → code-hardener → quality |
| "document the..." | documentation → communication |
| "think about..." | breakthrough-overdrive-innovation |
| "research..." | deep-research → research |

---

## 17. Automation & Cron Jobs

### Built-in jobs

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `nightshift-full` | Daily 10 PM | Full codebase improvement |
| `nightly-audit` | Daily 2 AM | Security + quality audit |
| `self-improve` | Daily 3 AM | Review past runs, update AGENTS.md |
| `codebase-health` | Daily 6 AM | Tests + lint + type check |
| `weekly-deps` | Monday 9 AM | Check outdated deps |

### Add custom job

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py add my-job \
  --schedule "0 9 * * 1" \
  --chain "security → quality → neuro" \
  --prompt "Weekly security audit"
```

### Run job now

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py run my-job
```

### List jobs

```bash
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py list
```

---

## 18. Pieces LTM

DreamCode integrates with Pieces for long-term memory:

### What gets persisted

- Every skill chain result
- Architecture decisions
- Bug fixes and their context
- Test results
- Security reviews

### How to search LTM

```bash
# Via MCP tool
pieces_search_memory --query "authentication" --time_ranges '[{"from": "2026-01-01", "to": "2026-12-31"}]'

# Via annotations
pieces_annotations_full_text_search --query "security audit"
```

### Manual persist

```bash
# Primary (opencode runtime): PiecesLTM.Service.persist({ ... })
# Fallback: python3 .opencode/skills/pieces-ltm/scripts/pieces_persist.py persist \
  --chain "neuro → code-hardener" \
  --task "Fixed authentication bug" \
  --outcome success \
  --files "src/auth.ts" \
  --decisions "Added rate limiting"
```

---

## 19. NEURO API (FREE)

> **DreamCode works best with NEURO — and it's completely free.**

The [NEURO API](https://neurometric.ai) gives DreamCode access to 120+ specialized AI models for domain-specific analysis, multi-perspective review, and architectural guidance.

### Get Your Free API Key

1. Visit [neurometric.ai](https://neurometric.ai) and sign up for a free account
2. Copy your API key from the dashboard
3. Set it in your environment:

```bash
export NEURO_API_KEY="your-key"
```

Or add it to `.env.secret` (DO NOT COMMIT):

```bash
echo 'NEURO_API_KEY=your-key' >> .env.secret
set -a; source .env.secret; set +a
```

### How it works

1. The model router selects the best model for your task
2. The NEURO API routes to that model
3. Results are combined with local analysis

### NEURO iterations

For complex tasks, NEURO runs up to 10 iterations:
- Iteration 1-3: Initial analysis
- Iteration 4-6: Deep review
- Iteration 7-9: Edge cases
- Iteration 10: Final synthesis

### What you get with NEURO (vs without)

| Feature | Without NEURO | With NEURO |
|---------|---------------|------------|
| Model routing | Local fallback only | 120+ specialized models |
| Review iterations | 1-2 local passes | Up to 10 NEURO iterations |
| Architecture review | Basic | Multi-perspective analysis |
| Edge case detection | Limited | Comprehensive |
| Cost | Free | Free |

### Skip NEURO (for trivial tasks)

```bash
# Trivial tasks skip NEURO automatically
# To force skip:
dreamcode --no-neuro
```

---

## 20. Troubleshooting

### "Build integrity check failures"

```bash
cd packages/opencode
bun run build
```

### "No sandbox binary found"

This is expected if sandbox is off (default). To enable:
```bash
sudo apt-get install -y firejail
export DREAMCODE_SANDBOX=on
```

### "unzip is required"

```bash
sudo apt-get install -y unzip
```

### "Tool registration not wired"

Check `packages/opencode/src/tool/registry.ts` line 107:
```typescript
const skilltool = yield* SkillTool
```

### "dreamcode command not found"

```bash
export PATH="$HOME/.bun/bin:$PATH"
# Or reinstall:
cd packages/opencode && npm install -g .
```

### "NEURO API unreachable"

DreamCode falls back to local analysis. Set the API key:
```bash
export NEURO_API_KEY="your-key"
```

### "Memory not persisting"

Check SQLite database:
```bash
ls -la ~/.local/share/dreamcode/memory.db
```

---

## 21. Power User Patterns

### Pattern 1: Full audit

```bash
dreamcode --prompt "run full security audit on this codebase"
```

This triggers: security → code-hardener → quality → neuro

### Pattern 2: Innovation mode

```bash
dreamcode --prompt "think about how to optimize the database layer"
```

This triggers: breakthrough-overdrive-innovation → neuro → code-hardener

### Pattern 3: Research + implement

```bash
dreamcode --prompt "research best practices for Flask rate limiting, then implement"
```

This triggers: deep-research → neuro → code-hardener → testing

### Pattern 4: Night shift

```bash
# Let DreamCode improve your codebase overnight
python3 .opencode/skills/scheduled-automations/scripts/scheduler.py run nightshift-full
```

### Pattern 5: Score tracking

```bash
# View your score
cat evolution/agent_score.json | python3 -m json.tool

# View chain log
tail -20 .opencode/chain_log.jsonl
```

### Pattern 6: Custom skill chains

```bash
# Run specific skills
dreamcode --skills "security,testing,quality" --prompt "audit this function"
```

### Pattern 7: Checkpoint recovery

```bash
# List checkpoints
cat .opencode/checkpoints/store.json | python3 -m json.tool

# Resume from checkpoint
dreamcode --resume <checkpoint-id>
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│                    DreamCode Cheat Sheet                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  INSTALL                                                │
│    curl -fsSL https://raw.githubusercontent.com/        │
│      weebcoder101/dreamcode/main/install.sh | bash      │
│                                                         │
│  RUN                                                    │
│    cd <project> && dreamcode                            │
│                                                         │
│  CONFIG                                                 │
│    ~/.config/dreamcode/config.yaml                      │
│                                                         │
│  SANDBOX                                                │
│    OFF by default                                       │
│    export DREAMCODE_SANDBOX=on                          │
│                                                         │
│  SKILLS (37)                                            │
│    META:    12 skills (always available)                │
│    CORE:    7 skills (code changes)                     │
│    LANG:    4 skills (language-specific)                │
│    TOOL:    3 skills (git, devops)                      │
│    SPEC:    5 skills (domain-specific)                  │
│    SOFT:    4 skills (cross-cutting)                    │
│                                                         │
│  CHAINS                                                 │
│    Bug:     debugging → testing → quality               │
│    Security: security → code-hardener → quality         │
│    Feature: planning → architecture → testing           │
│    Research: deep-research → neuro → code-hardener      │
│    Full:    context-compactor → exhaustive → neuro →    │
│             model-router → code-hardener → lint-fixer → │
│             pieces-ltm → automated-learning             │
│                                                         │
│  SCORING                                                │
│    +10 sensor gate  +5 skill  +15 chain  +10 test       │
│    -25 gate skipped  -30 dream skipped  -50 rejected    │
│                                                         │
│  FILES                                                  │
│    Config:    ~/.config/dreamcode/config.yaml           │
│    Memory:    ~/.local/share/dreamcode/memory.db        │
│    Checkpoints: .opencode/checkpoints/store.json        │
│    Scores:    evolution/agent_score.json                │
│    Chain log: .opencode/chain_log.jsonl                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

**Built with dream thinking. Ship with confidence.**

# DreamCode — The Dreamer's Agent

[![Install Test](https://github.com/weebcoder101/dreamcode/actions/workflows/install_test.yml/badge.svg)](https://github.com/weebcoder101/dreamcode/actions/workflows/install_test.yml)

> **New to DreamCode?** Read the **[Complete Guide](GUIDE.md)** — architecture, skills, configuration, and advanced patterns.

An open-source AI coding agent with native dream thinking, 37-skill dynamic graph, memory consolidation, and scoring enforcement.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh | bash
```

Or clone:

```bash
git clone https://github.com/weebcoder101/dreamcode && cd dreamcode && bash install.sh
```

## What DreamCode Is

DreamCode is a fork of [opencode-go](https://github.com/anomalyco/opencode) with:
- **MiMo-Code's** memory system (SQLite FTS5), dream prompts, actor system, task tracking
- **Our skill system** (37 skills, dynamic graph, model router, scoring)
- **Native execution** — skills are TypeScript tools, not external scripts

## How It Differs from OpenCode

| Feature | OpenCode | DreamCode |
|---------|----------|-----------|
| Skills | External SKILL.md files | Native TypeScript tools |
| Memory | Basic | SQLite FTS5 with reconciliation |
| Dream | None | 6-phase memory consolidation |
| Scoring | None | Risk/reward enforcement |
| Model Router | None | 120+ NEURO models, domain-specific |
| Dynamic Graph | Static chain | 37-skill dependency graph |
| Subagents | Basic | Full lifecycle management |
| Context | Basic | Auto-checkpoint + reconstruction |
| Sandbox | On by default | **Off by default, opt-in only** |

## How It Differs from MiMo-Code

| Feature | MiMo-Code | DreamCode |
|---------|-----------|-----------|
| Skills | ~10 skills | 37 skills |
| Model Router | None | 120+ NEURO models |
| Scoring | None | Risk/reward enforcement |
| Dynamic Graph | None | 37-skill dependency graph |
| Chain Enforcer | None | Backtesting verification |

## Quick Start

```bash
# Start dreamcode
dreamcode

# Or with API key
OPENAI_API_KEY=your-key dreamcode
```

## NEURO API (Highly Recommended — Free)

DreamCode works best with the [NEURO API](https://neurometric.ai) — **120+ specialized AI models, completely free**.

```bash
# Get your free key at https://neurometric.ai
export NEURO_API_KEY="your-key"
```

Without NEURO, DreamCode falls back to local analysis only. With NEURO, you get domain-specific model routing, multi-perspective analysis, and up to 10 review iterations.

See [GUIDE.md §19 — NEURO API](GUIDE.md#19-neuro-api) for full setup.

## Configuration

DreamCode config lives at `~/.config/dreamcode/config.yaml`:

```yaml
sandbox: false          # OFF by default — set to true to enable firejail
dream_mode: true        # Enable 6-phase dream thinking
scoring: true           # Enable scoring enforcement
model_router: true      # Enable 120+ model routing
```

**Sandbox is OFF by default.** DreamCode runs with full filesystem access unless you explicitly enable sandbox mode. See [GUIDE.md](GUIDE.md) for details.

## Skills (37)

DreamCode has 37 native skills organized in a dynamic graph:

### META (12)
context-compactor, exhaustive-crosscheck, neuro, model-router, code-hardener, lint-fixer, pieces-ltm, automated-learning, chain-orchestrator, guardian-ai, breakthrough-overdrive-innovation, automation

### CORE (7)
planning, architecture, quality, security, testing, debugging, performance

### LANGUAGE (4)
python, frontend, react, api

### TOOL (3)
git, git-feature-workflow, devops

### SPECIALIZED (5)
quantum, data, research, deep-research, documentation

### SOFT SKILL (4)
communication, product, refactoring, onboarding

## Architecture

```
User Prompt
    ↓
Sensor Gate (classify intent)
    ↓
Dynamic Graph (select skills)
    ↓
Dream Thinking (6 phases: research, ground, reflect, propose, build)
    ↓
Skill Chain (execute selected skills)
    ↓
Scoring (record points)
    ↓
Memory Consolidation (SQLite FTS5)
    ↓
Response
```

## VS Code Integration

DreamCode includes full VS Code support:
- `.vscode/settings.json` — TypeScript, formatting, file exclusions
- `.vscode/tasks.json` — Build, dev, test, typecheck, sensor gate
- `.vscode/launch.json` — Debug TUI, attach to running instance
- `.vscode/extensions.json` — Recommended extensions

## Antigravity IDE Integration

DreamCode is designed for Antigravity IDE. Open your project in Antigravity and the `.opencode/` config is auto-detected. See [GUIDE.md](GUIDE.md) for the full Antigravity workflow.

## Documentation

For the complete walkthrough of every feature, see **[GUIDE.md](GUIDE.md)** — covers architecture, all 37 skills, NEURO setup, Pieces LTM, and advanced patterns.

## Credits

- [OpenCode](https://github.com/anomalyco/opencode) — Base agent framework
- [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) — Memory system, dream prompts, actor system
- [MiMo](https://github.com/XiaomiMiMo/MiMo) — MiMo-7B RL model
- [NEURO](https://neurometric.ai) — 120+ specialized models
- [Pieces](https://pieces.app) — Long-term memory integration

## License

MIT

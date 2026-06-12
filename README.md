# DreamCode — The Dreamer's Agent

An open-source AI coding agent with native dream thinking, 37-skill dynamic graph, memory consolidation, and scoring enforcement.

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

## How It Differs from MiMo-Code

| Feature | MiMo-Code | DreamCode |
|---------|-----------|-----------|
| Skills | ~10 skills | 37 skills |
| Model Router | None | 120+ NEURO models |
| Scoring | None | Risk/reward enforcement |
| Dynamic Graph | None | 37-skill dependency graph |
| Chain Enforcer | None | Backtesting verification |

## Installation

```bash
# Install from source
git clone https://github.com/ronya/dreamcode.git
cd dreamcode
bun install
bun run build
npm install -g ./packages/opencode
```

## Quick Start

```bash
# Start dreamcode
dreamcode

# Or with API key
OPENAI_API_KEY=your-key dreamcode
```

## Configuration

DreamCode reads the same config as OpenCode, plus:

```yaml
# ~/.config/dreamcode/config.yaml
sandbox_mode: workspace-write
approval_policy: on-request
dream_mode: true  # Enable dream thinking
scoring: true     # Enable scoring enforcement
```

## Skills

DreamCode has 37 native skills organized in a dynamic graph:

### META (12)
breakthrough-overdrive-innovation, context-compactor, exhaustive-crosscheck, neuro, model-router, code-hardener, lint-fixer, pieces-ltm, automated-learning, chain-orchestrator, guardian-ai, automation

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
Dream Thinking (research, ground, reflect, propose)
    ↓
Skill Chain (execute selected skills)
    ↓
Chain Enforcer (verify execution)
    ↓
Scoring (record points)
    ↓
Memory Consolidation (persist knowledge)
    ↓
Response
```

## API Connection

DreamCode connects to the opencode-go API:

```bash
# Set API endpoint
export OPENCODE_API_URL=https://api.opencode.ai

# Or use local instance
export OPENCODE_API_URL=http://localhost:4096

# Start with API
dreamcode --api
```

## Credits

- [OpenCode](https://github.com/anomalyco/opencode) — Base agent framework
- [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) — Memory system, dream prompts, actor system
- [MiMo](https://github.com/XiaomiMiMo/MiMo) — MiMo-7B RL model
- [NEURO](https://neurometric.ai) — 120+ specialized models
- [Pieces](https://pieces.app) — Long-term memory integration

## License

MIT

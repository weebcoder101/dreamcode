# DreamCode — The Dreamer's Agent

[![Install Test](https://github.com/weebcoder101/dreamcode/actions/workflows/install_test.yml/badge.svg)](https://github.com/weebcoder101/dreamcode/actions/workflows/install_test.yml)

> **New to DreamCode?** Read the **[Complete Guide](GUIDE.md)** — architecture, skills, configuration, and advanced patterns.

An open-source AI coding agent with native dream thinking, 37-skill dynamic graph, memory consolidation, and scoring enforcement.

## Architecture at a Glance

DreamCode's harness runs two gates around every LLM call:

- **Sensor Gate** (pre-LLM) — classifies each user turn: intent, risk, skill chain, and whether to spawn specialist personas. `<sensor-gate state="minimal">` disables persona spawning for cost control.
- **Dream Gate** (per-mutation) — enforces plan-before-edit on file changes with per-file approval and a learned sufficiency threshold. Its block messages *teach*: they explain exactly why an edit was blocked and how to pass.

Around them: BM25-style cross-session memory (`<historical-context>` in the KV-cache-safe system tail), crash-resume session checkpoints, taste-weighted model routing, and strict parent/subagent model isolation.

- **Full architecture reference** → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Complete chronological log of everything built** → [docs/TOTAL-LOG.md](docs/TOTAL-LOG.md)
- **Sensor gate detail** → [docs/sensor-gate.md](docs/sensor-gate.md)

---

> **🔴 WARNING — Parallel Subagents & Cost**
>
> DreamCode spawns **parallel subagent workers** to analyze your code from multiple perspectives
> simultaneously. Each subagent runs its own LLM inference on a **separate model instance** and
> consumes API tokens independently.
>
> **Without configuration, subagents use the SAME model as the parent — multiplying your costs.**
> A typical task spawns 3-5 subagents. At Claude Opus pricing (~$15/1M input tokens), that's
> $0.75 per task. With a cheaper model like `gpt-4o-mini` (~$0.15/1M), the same task costs
> $0.0075 — **100x cheaper**.
>
> **How to configure:**
> - **Parent model** — The main agent that orchestrates and synthesizes. Selected via `/models`
>   in the TUI (or the model dialog in the footer).
> - **Subagent model** — The parallel workers that do analysis. Selected via the **subagent model
>   indicator** in the TUI footer. Click it to open the model selector and pick a cheaper model
>   (e.g., `gpt-4o-mini`, `claude-3-haiku`, `deepseek-chat`).
> - **Clear subagent override** — Use the "Clear" option in the subagent model dialog to reset
>   back to the parent model.
>
> The parent agent orchestrates. Subagents execute analysis in parallel. **Don't pay premium
> prices for parallel workers.**

---

## Quick Install

### One-line install (recommended)

**Linux / macOS (bash):**
```bash
curl -fsSL https://raw.githubusercontent.com/weebcoder101/dreamcode/stable-release/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/weebcoder101/dreamcode/stable-release/install.ps1 | iex
```

**Windows (WSL2):**
```bash
# Inside WSL2 terminal — same as Linux
curl -fsSL https://raw.githubusercontent.com/weebcoder101/dreamcode/stable-release/install.sh | bash
```

### Or clone and install

**Linux / macOS (bash):**
```bash
git clone https://github.com/weebcoder101/dreamcode && cd dreamcode && bash install.sh
```

**Windows (PowerShell / cmd):**
```powershell
git clone https://github.com/weebcoder101/dreamcode; cd dreamcode; .\install.ps1
```

### Manual build (for developers)

**Linux / macOS:**
```bash
git clone -b stable-release https://github.com/weebcoder101/dreamcode
cd dreamcode
bun install
cd packages/opencode && OPENCODE_VERSION=1.4.0 bun run build --single

# The binary is at dist/dreamcode-<platform>-<arch>/bin/dreamcode
# Create a symlink so `dreamcode` is available globally:
mkdir -p ~/.local/bin
ln -sf "$(pwd)/dist/dreamcode-linux-x64/bin/dreamcode" ~/.local/bin/dreamcode
# (adjust "linux-x64" to your arch: darwin-x64, darwin-arm64, linux-arm64)
export PATH="$HOME/.local/bin:$PATH"
# Add the export line above to your ~/.bashrc or ~/.zshrc to make it permanent

# Verify
dreamcode --version
```

**Windows (PowerShell):**
```bash
git clone -b stable-release https://github.com/weebcoder101/dreamcode
cd dreamcode
bun install
cd packages\opencode; $env:OPENCODE_VERSION="1.4.0"; bun run build --single --skip-embed-web-ui

# The binary is at .\dist\dreamcode-windows-x64\bin\dreamcode.exe
# Copy it to a standard location and add to PATH:
$dst = "$env:LOCALAPPDATA\dreamcode\bin"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$pwd\dist\dreamcode-windows-x64\bin\dreamcode.exe" "$dst\dreamcode.exe" -Force
$env:Path = "$dst;$env:Path"
# Add the path to your PowerShell profile for future sessions:
[Environment]::SetEnvironmentVariable("Path", "$dst;$env:Path", "User")

# Verify
dreamcode --version
```

**Troubleshooting:** If `dreamcode: command not found`, ensure the symlink target path or `$dst` directory is on your `PATH`. On Linux/macOS run `echo $PATH` to check; on Windows open a new PowerShell terminal.

### Requirements

| Requirement | Linux | macOS | Windows |
|-------------|-------|-------|---------|
| **bun** ≥ 1.3.x | Auto-installed | Auto-installed | Auto-installed (source build) |
| **Python** ≥ 3.10 | Optional | Optional | Optional |
| **pip3** | Optional | Optional | N/A |
| **unzip** | Auto-installed | Auto-installed | Built-in |

### Platform Support

| Platform | Binary | Installer | Status |
|----------|--------|-----------|--------|
| Linux x64 | `dreamcode-linux-x64` | `install.sh` | ✅ Primary |
| Linux arm64 | `dreamcode-linux-arm64` | `install.sh` | ✅ |
| macOS x64 (Intel) | `dreamcode-darwin-x64` | `install.sh` | ✅ |
| macOS arm64 (Apple Silicon) | `dreamcode-darwin-arm64` | `install.sh` | ✅ |
| Windows x64 | `dreamcode-windows-x64` | `install.ps1` | ✅ |
| Windows arm64 | `dreamcode-windows-arm64` | `install.ps1` | ⚠️ Requires `-BuildFromSource` |

### Post-install

After install, run:
```bash
# Start dreamcode in any project directory
dreamcode

# Or with an API key
OPENAI_API_KEY=your-key dreamcode
```

**Windows PowerShell:**
```powershell
# Start dreamcode in any project directory
dreamcode

# Or with an API key
$env:OPENAI_API_KEY = "your-key"; dreamcode
```

### Troubleshooting Install

- **Build fails on fresh clone**: Run `cd packages/opencode && bun run build --single` — ensures `bin/` directory exists for the symlink.
- **`dreamcode: command not found`** (Linux/macOS): Add `~/.local/bin` and `~/.bun/bin` to your PATH, or re-run install.sh.
- **`dreamcode` not recognized** (Windows): Open a **new** PowerShell terminal — PATH changes apply to new sessions.
- **Python skills not working**: Run `pip3 install -r .dreamcode/requirements.txt`
- **Sandbox mode not available** (macOS): firejail is Linux-only; set `sandbox: false` in config.yaml.

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

| Guide | Description |
|-------|-------------|
| **[GUIDE.md](GUIDE.md)** | Complete walkthrough — architecture, 37 skills, NEURO, Pieces LTM, advanced patterns |
| **[SECURITY.md](SECURITY.md)** | Security policy, sandbox model, credential storage, vulnerability reporting |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Development setup, PR guidelines, coding conventions |
| **[AGENTS.md](AGENTS.md)** | Build system, architecture, code patterns (internal developers — gitignored) |
| **[docs/](docs/)** | Detailed guides for specific features |

### Key Topics
- **[Dream Thinking](docs/dream-thinking.md)** — The 6-phase engine behind DREAM_INNOVATION mode
- **[37 Skills Reference](docs/skills.md)** — Complete catalog with activation conditions and config
- **[Configuration Reference](docs/config.md)** — Full YAML schema with all options
- **[NEURO API Setup](docs/neuro.md)** — 120+ specialized models, free to use
- **[Sensor Gate](docs/sensor-gate.md)** — Intent classification, chain selection, spawn decisions

## Credits

- [OpenCode](https://github.com/anomalyco/opencode) — Base agent framework
- [MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) — Memory system, dream prompts, actor system
- [MiMo](https://github.com/XiaomiMiMo/MiMo) — MiMo-7B RL model
- [NEURO](https://neurometric.ai) — 120+ specialized models
- [Pieces](https://pieces.app) — Long-term memory integration

## License

MIT

# Configuration Reference

## Config File Location

`~/.config/dreamcode/config.yaml`

## Quick Start Config

```yaml
sandbox: false              # OFF by default — set true to enable firejail
dream_mode: true            # Enable 6-phase dream thinking
scoring: true               # Enable scoring enforcement
model_router: true          # Enable 120+ model routing
```

## Full Schema

### Core Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `sandbox` | `bool` | `false` | Enable firejail sandbox isolation |
| `dream_mode` | `bool` | `true` | Enable 6-phase dream thinking engine |
| `scoring` | `bool` | `true` | Enable risk/reward scoring enforcement |
| `model_router` | `bool` | `true` | Enable domain-specific model routing |

### NEURO API

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `neuro.api_key` | `string` | env `NEURO_API_KEY` | NEURO API key for 120+ models |
| `neuro.endpoint` | `string` | `https://api.neurometric.ai` | API endpoint |
| `neuro.timeout` | `int` | `30000` | Request timeout in ms |

### Compaction

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `compaction.auto` | `bool` | `true` | Enable automatic context compaction |
| `compaction.prune` | `bool` | `true` | Enable tool output pruning |
| `compaction.tail_turns` | `int` | `2` | Recent turns preserved verbatim |
| `compaction.preserve_recent_tokens` | `int` | `2000-8000` | Token budget for recent turns |
| `compaction.reserved` | `int` | `20000` | Buffer tokens for compaction |

### Scoring

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `scoring.points_per_action` | `int` | `10` | Points awarded per completed action |
| `scoring.penalty_threshold` | `int` | `-50` | Score floor before enforcement |
| `scoring.reward_multiplier` | `float` | `1.5` | Multiplier for high-quality outcomes |

### Model Router

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `model_router.strategy` | `enum` | `domain` | Routing strategy: `domain`, `round-robin`, `fastest` |
| `model_router.fallback` | `string` | `openai/gpt-4o` | Fallback model when routing fails |
| `model_router.cache_ttl` | `int` | `300` | Route cache TTL in seconds |

### Sensor Gate

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `sensor_gate.enabled` | `bool` | `true` | Enable intent classification |
| `sensor_gate.min_confidence` | `float` | `0.5` | Minimum confidence for gate decisions |
| `sensor_gate.max_personas` | `int` | `5` | Maximum specialist agents per request |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `NEURO_API_KEY` | NEUROMETRIC API key (free, 120+ models) |
| `DREAMCODE_SANDBOX` | Enable sandbox: `on`/`off` |
| `DREAMCODE_DIR` | Custom install directory |
| `OPENCODE_VERSION` | Override version for builds |
| `AI_SDK_ALLOWED_PACKAGES` | Comma-separated allowlist for dynamic provider loading |
| `XDG_RUNTIME_DIR` | Runtime directory for temp files |
| `OPENCODE_RELEASE` | Set to `true` for release mode builds |

## Provider Configuration

DreamCode supports 120+ LLM providers through the NEURO API and standard AI SDK providers:

```bash
# OpenAI-compatible
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# NEURO (120+ specialized models)
export NEURO_API_KEY="nk-..."
```

See [NEURO API Setup](neuro.md) for the full provider catalog.

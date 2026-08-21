# Neuro Skill Context

## State Summary
**Date/Time:** 2026-05-20
**Repo Root:** $(pwd)
**Live Neuro Status:** Connected

## Configuration

| Variable | Value | Source |
|----------|-------|--------|
| `NEURO_API_KEY` | *(set via environment variable)* | Set in `.env.secret` or shell env |
| `NEURO_API_BASE_URL` | `https://api.neurometric.ai/v1` | Neurometric marketplace |
| Model | `neurometric/clawpack` | Harness default (OpenAI-compatible) |

## Harness Location
- `.opencode/skills/neuro/scripts/neuro_harness.py`

## Usage

### Prerequisite
```bash
# Create .env.secret (DO NOT COMMIT)
echo "NEURO_API_KEY=your_key_here" >> .env.secret
echo "NEURO_API_BASE_URL=https://api.neurometric.ai/v1" >> .env.secret

# Source it
set -a; source .env.secret; set +a
```

### Run
```bash
python .opencode/skills/neuro/scripts/neuro_harness.py \
    --task "review monte carlo output" \
    --user-context-file context.txt \
    --file target.py \
    --phase pre_patch
```

## Caveats
- API key is provided via environment variable — never hardcode it in files.
- The harness defaults to model `neurometric/clawpack` — change via `NEURO_MODEL` env var if needed.
- All 10 neuro iterations (pre_patch) + 5 code-hardener iterations + 5 lint-fixer loops are mandatory for non-trivial code changes.

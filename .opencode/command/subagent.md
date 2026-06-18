# Subagent Model Selection

## How this works

Your current subagent model is **{{parentModel}}** — which is the parent session model.

Subagents inherit the parent model by default. If your parent model is expensive (e.g., o1, claude-opus), each subagent spawn costs the same per-token rate. With 3-5 subagents per task, costs add up quickly.

You can set a cheaper model for subagents to reduce costs.

## Usage

- `/subagent` — Shows this menu. Lists your saved models for selection.
- `/subagent <providerID>/<modelID>` — Sets the subagent model immediately.

## Recommended low-cost subagent models

| Model | Why |
|-------|-----|
| deepseek/deepseek-v4-flash | Fast, low cost, good at analysis tasks |
| openai/mimo-v2.5 | Very low cost, adequate for analysis |
| openai/gpt-4o | Balances cost and quality |

## To configure

1. Run `/models` to see your available models
2. Choose one and run `/subagent <providerID>/<modelID>`
3. Or respond with "keep parent" to continue with the current model

## To clear / reset to parent model

Run: `/subagent off`

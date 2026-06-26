---
name: customize-opencode
description: "Customize opencode configuration, theme, keybindings, and agent settings. Use when modifying dreamcode/opencode behavior, adding custom agents, or adjusting system preferences."
chains_with:
  - documentation
  - architecture
---

# Customize OpenCode Skill

## Mandate

When customizing opencode, always back up existing configuration before modifying.
Test configuration changes incrementally. Verify that changes don't break existing
agent workflows or skill chains.

## Trigger Conditions

- User wants to modify opencode behavior
- Adding custom agents or tools
- Changing keybindings or theme
- Adjusting model settings or provider configuration
- Modifying permission policies

## Process

1. **Read current config**: Load `dreamcode.json` or `.opencode/config.json`
2. **Identify the change**: What specific behavior is being customized?
3. **Apply surgically**: Make minimal, targeted changes to config
4. **Verify**: Check that existing functionality still works
5. **Document**: Note the change in config comments or changelog

## Config Locations

- **Project config**: `.dreamcode/dreamcode.json` or `.opencode/config.json`
- **Global config**: `~/.config/dreamcode/config.json`
- **Agent config**: `.dreamcode/agents/*.json`
- **Skill config**: `.dreamcode/skills/*/SKILL.md`

## Safety Rules

1. Never delete config without explicit user confirmation
2. Always preserve required fields (model, provider settings)
3. Test agent behavior after config changes
4. Keep a rollback path for destructive changes

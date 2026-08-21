# Project Taste — dreamcode

> Auto-learned by the harness from your prompts, edits, and project structure.
> Edit freely — content between the `manual` markers below is preserved on regeneration.

## Tech Stack
- Languages: TypeScript, Python
- Package managers: npm
- Stack: Docker
- Tests: Unit, E2E

## Anti-Preferences
- correction: user-rejected-output

## Folder Structure
- .dreamcode/
- .opencode/
- bin/
- docs/
- packages/

## Coding Style
- always: all

## Preferences
- preferred-tool: clarification

## Communication
- verbosity: keep it

## Tools
- bash
- websearch
- read
- grep
- edit

<!-- manual:start -->
<!-- These preferences are HUMAN-VERIFIED and survive auto-regeneration. -->
<!-- They shape agent behavior, not just describe the project. -->

- Highly cost-conscious about LLM API usage: treats exorbitant token costs as a bug to be fixed. Expects prompt caching, KV cache TTL, and stable presets to be implemented correctly so context is not re-sent and re-billed every request. When choosing models, prefer free/cheap options (hy3-free, deepseek-v4-flash) over expensive ones (Claude, GPT-4). Confidence: 0.95
- Complete-then-build workflow: when a task involves multiple fixes, do ALL code changes first and verify, then rebuild the binary ONCE. Never run bare `bun run build` — always use `bun run build -- --single` for the current platform. Verify the build artifact works before reporting done. Confidence: 0.9
- Prefers the agent to run `bun` for tests and commands directly without asking for permission first ("run bun, never ask"). Confidence: 0.85
- Always use tree-sitter structural tools (ast-edit, relations) FIRST before fuzzy string edits. Use `relations` (whoProvides/consumersOf) to map call graphs, then `lsp` (goToDefinition/documentSymbol), then `read` the file — only then `edit`/`write`. Confidence: 0.9
- Prefers concise, direct responses. Lead with the verdict/answer, no preamble. Use tables for comparisons. One-word answers are best for simple questions. Confidence: 0.8

<!-- manual:end -->

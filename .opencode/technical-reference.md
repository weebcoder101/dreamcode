# Technical Reference — DreamCode Monorepo

LOCAL ONLY. Not tracked by git. This preserves the project-specific technical
documentation that was previously in AGENTS.md files. The Sumati persona mandate
is now at `AGENTS.md` (root).

---

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

## Style Guide

### General Principles
- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible
- Prefer functional array methods (flatMap, filter, map) over for loops
- In `src/config`, follow existing self-export pattern

### Destructuring
Avoid unnecessary destructuring. Use dot notation to preserve context.

### Imports
- Never alias imports (`import { foo as bar }`)
- Never use star imports (`import * as Foo`)
- Prefer dynamic imports for heavy modules in startup-sensitive code

### Variables
Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

### Control Flow
Avoid `else` statements. Prefer early returns.

### Schema Definitions (Drizzle)
Use snake_case for field names so column names don't need to be redefined as strings.

## Testing
- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`)

## Type Checking
- Always run `bun typecheck` from package directories, never `tsc` directly
- NEVER run `bun turbo typecheck` — it crashes WSL via OOM

## GIT PUSH — SAFETY RULE
NEVER run `git push` directly. Use:
```bash
bash /home/ronya/Pilot-Project/.opencode/scripts/safe_git_push.sh origin dreamcode-fork "msg" /home/ronya/dreamcode
```

## bun Runtime Quirks
- bun 1.3.x has a rest-parameter bug affecting effect v4's Schema library
- Workaround via `effectPlugin` in `packages/opencode/script/build.ts`

## Architecture Anti-Patterns
- `Effect.die` for control flow in `packages/core/src/session/runner/llm.ts` — defeats error tracking
- Credential storage in `packages/core/src/credential/sql.ts` — unencrypted JSON in SQLite

## Persona System Config
- `MAX_PERSONA_ROUNDS = 3` (src/session/prompt.ts:150)
- personaRoundMap tracks rounds per session
- sensorGateFiredMap persists across messages
- Persona subagents get `disableTaskTool: true`
- Background subagents have `neverAbort` flag

## Build Commands
```bash
# Build opencode binary
cd packages/opencode && OPENCODE_VERSION=1.2.1 bun run build --skip-embed-web-ui --skip-install --single

# Typecheck single package
cd packages/opencode && bun run typecheck
cd packages/core && bun run typecheck

# Run tests
cd packages/opencode && bun test --timeout 30000
```

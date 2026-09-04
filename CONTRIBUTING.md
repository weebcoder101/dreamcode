# Contributing to DreamCode

## Development Setup

```bash
# Clone
git clone https://github.com/weebcoder101/dreamcode
cd dreamcode

# Install dependencies
bun install

# Install Python dependencies (for skill scripts)
pip3 install -r .dreamcode/requirements.txt

# Build
cd packages/opencode && OPENCODE_VERSION=1.2.8 bun run build --single
```

## Project Structure

```
dreamcode/
├── packages/
│   ├── opencode/     # Main CLI + TUI binary
│   │   ├── src/      # TypeScript source
│   │   └── script/   # Build scripts
│   ├── core/         # @opencode-ai/core — Effect-TS services
│   ├── cli/          # @opencode-ai/cli
│   ├── app/          # Web UI (embedded in binary)
│   └── desktop/      # Electron desktop app
├── .dreamcode/       # Skill scripts and configurations
│   └── skills/       # 38 skill definitions
└── docs/             # Documentation
```

## Code Conventions

See [AGENTS.md](AGENTS.md) for the full style guide. Key rules:

### TypeScript
- Use `Effect.gen(function* () { ... })` for effectful code
- Never use `any` — use `unknown` with type guards
- Prefer `const` over `let`
- Use early returns, avoid `else`
- No star imports or renamed imports
- Use snake_case for database column names

### Commits
Follow conventional commits:
```
feat(core): add session recovery
fix(tui): simplify thinking toggle styling
docs: update contributing guide
chore(sdk): regenerate types
```

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

### Branch Names
Short names, no slashes, max 3 words:
- `session-recovery`
- `fix-scroll-state`
- `regenerate-sdk`

## Testing

```bash
# Typecheck (from package directory only!)
cd packages/opencode && bun run typecheck

# Run tests
cd packages/opencode && bun test --timeout 30000

# NEVER run from repo root: bun turbo typecheck
# (causes OOM on WSL)
```

## Build System

```bash
# Single-platform build (local dev)
cd packages/opencode && OPENCODE_VERSION=1.2.8 bun run build --single

# Cross-compile (all 12 platforms)
cd packages/opencode && OPENCODE_VERSION=1.2.8 bun run build
```

The build script (`packages/opencode/script/build.ts`):
- Compiles with Bun.build + `--compile`
- Patches effect v4 for bun 1.3.x compatibility
- Creates `bin/opencode` symlink → native binary
- Runs smoke test on native platform

## Pull Request Process

1. Create a branch from `dev`
2. Make changes following code conventions
3. Run typecheck + tests
4. Push and create PR against `dev`
5. Ensure CI passes (install test, typecheck, lint)

## Adding Skills

Skills are TypeScript tools in `packages/opencode/src/skill/`. Each skill needs:
1. A TypeScript tool file
2. Registration in the skill registry
3. Optional: Python scripts in `.dreamcode/skills/<skill>/scripts/`

See [AGENTS.md](AGENTS.md#skill-package-learnings) for skill implementation patterns.

## Questions?

Open a [GitHub Issue](https://github.com/weebcoder101/dreamcode/issues) or check [GUIDE.md](GUIDE.md) for feature documentation.

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash activity recovery requires a separate explicit design before it may retry provider work.
- Keep delivery vocabulary explicit. Prompts steer by default and coalesce into the active activity at the next safe provider-turn boundary. Explicit `queue` inputs open FIFO future activities one at a time after the active activity settles.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## GIT PUSH — MANDATORY RULE (WSL CRASH PREVENTION)

NEVER run `git push`, `git fetch`, or `git pull` directly in the bash tool.
Direct git push blocks the agent process group and crashes WSL.
The repo has a pre-push hook (`.husky/_/pre-push`) that runs `bun turbo typecheck`
— this takes >60 seconds and causes timeouts. The safe wrapper uses `--no-verify`.

ALWAYS use the safe wrapper instead:

bash /home/ronya/Pilot-Project/.opencode/scripts/safe_git_push.sh [remote] [branch] [commit_msg] [repo_path]

For dreamcode repo:
bash /home/ronya/Pilot-Project/.opencode/scripts/safe_git_push.sh origin dreamcode-fork "msg" /home/ronya/dreamcode

Check status: tail -10 /home/ronya/Pilot-Project/.opencode/git_push.log

## bun Runtime Quirks

### bun 1.3.x rest-parameter bug

bun 1.3.14 has a runtime bug where TypeScript rest parameters in minified/compiled code
are corrupted: `function fn(...args)` becomes `function fn(args)` where `args` is the
**first element** instead of the **array of all arguments**. This affects effect v4's Schema
library (`Schema.Union(...members)`, `Schema.check(...checks)`, etc.).

The bug affects BOTH `bun run` (JS) and `bun build --compile` (binary), not just compile mode.
Canary (1.4.0-canary) introduced a JSON parser regression that breaks the build script's
`define` values with ternary/spread operators.

**Workaround**: The `effectPlugin` in `packages/opencode/script/build.ts` patches effect dist
files to replace rest parameters with `arguments`-based collection. See
`packages/opencode/script/AGENTS.md` for details.

### `bun upgrade --canary` breaks `define` values

bun 1.4.0-canary+0c537fef8 enforces strict JSON parsing on `Bun.build({ define: {...} })` values,
rejecting ternary/spread operators. This breaks the build script's `define` block.
Downgrade with `bun upgrade --stable`.

## TYPECHECK — NEVER run `bun turbo typecheck` with default concurrency

`bun turbo typecheck` at the monorepo root spawns 29 parallel tsc processes
and crashes WSL via OOM (Hyper-V memory exhaustion). This has happened
repeatedly (Jun 13 2026).

ALWAYS use limited concurrency:

```bash
bun turbo typecheck --concurrency=2
```

Or check only the specific package that changed:

```bash
cd packages/opencode && bun run typecheck
```

NEVER run the full root typecheck in a dreamcode session. Run it only from
Windows PowerShell or a dedicated WSL terminal not shared with dreamcode.

## HARD STOP — bun turbo typecheck IS BANNED IN DREAMCODE SESSIONS

Running `bun turbo typecheck` in any form from inside a dreamcode session
CRASHES WSL. This has happened 4+ times today (Jun 13 2026).

YOU ARE FORBIDDEN FROM RUNNING:
- bun turbo typecheck
- bun turbo typecheck --concurrency=N
- turbo typecheck
- npx turbo typecheck

If you need to verify types, run ONLY:
cd packages/opencode && bun run typecheck 2>&1 | tail -20

This is non-negotiable. No exceptions. The typecheck ban applies for the
entire dreamcode session lifetime.

## Security Boundaries

### Dynamic npm Loading (packages/core/src/plugin/provider/dynamic.ts)
- Plugin accepts arbitrary npm package specifiers for AI SDK providers
- **ALLOWLIST**: Set `AI_SDK_ALLOWED_PACKAGES` env var (comma-separated) to restrict
- Default allowlist: @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, @ai-sdk/mistral, @ai-sdk/deepseek, @ai-sdk/togetherai, @ai-sdk/groq
- Packages NOT in allowlist will be rejected with error
- This prevents arbitrary code execution via malicious provider config

### Core Wildcard Exports (packages/core/package.json)
- `./*": "./src/*.ts"` exposes ALL internal files as public API
- 45+ consumer subpaths bypass the intended `public/index.ts` boundary
- **DEPRECATED**: Will be removed in future major version
- Migrate consumers to `@opencode-ai/core/public` or `@opencode-ai/core/internal`
- Internal subpath: `@opencode-ai/core/internal` (packages/core/src/internal/index.ts)

### V1 Deprecation (packages/core/src/v1/)
- V1 session/permission schemas are DEPRECATED but still active
- Used by projector bridge (session/projector.ts) for backward compatibility
- Session creation at session.ts:212 calls V1 SessionInfo.make() for V2 sessions
- Do NOT remove V1 until projector bridge is migrated to pure V2

## Architecture Anti-Patterns

### Effect.die for Control Flow (packages/core/src/session/runner/llm.ts)
- TurnTransitionError uses `Effect.die` for internal control flow
- This defeats Effect-TS error tracking (uncatchable by upstream handlers)
- `retryAgentMismatch` uses `Effect.catchDefect` which won't catch error-channel values
- **TODO**: Convert to `Effect.fail` with proper tagged errors when refactoring
- Documented in ADR-006 (Session Run Coordinator Durability Gap)

### Credential Storage (packages/core/src/credential/sql.ts)
- OAuth tokens/API keys stored as unencrypted JSON in SQLite
- Any process with filesystem access can extract all credentials
- **TODO**: Implement AES-256-GCM encryption with OS keychain-derived key
- Tracked as CRITICAL security issue in architecture synthesis

## Effect HTTP error handling

### `isRespondable` does NOT mean "declared in endpoint schema"

`HttpServerRespondable.isRespondable(error)` checks only whether the error type implements the `Respondable` interface (has a `[Respondable.symbol]()` method). It does NOT check whether the error is declared in the endpoint's HttpApi schema.

When a Respondable error (like `ApiNotFoundError` with `httpApiStatus: 404`) is thrown but NOT listed in the endpoint's `error: [...]` schema, the framework's `causeResponse` produces `internalServerError()` (empty 500 body). The error was "Respondable by type" but "undeclared on endpoint" — the framework has no codec for it.

**Fix**: Error-catching middleware should NOT use `isRespondable` as a guard for typed fail errors. Always catch all fail reasons and produce a JSON response with the error message and an appropriate status code.

### Layer lifecycle: `handlerPromise` caches failures permanently

`HttpEffect.toWebHandlerLayerWith` caches the layer build result in a `handlerPromise` via `??=`. Once this promise rejects (layer build failure), it is NEVER retried. Every subsequent request sees the same failure. There is no heal-after-failure path. Process restart is required.

Layer build errors are raw JS exceptions (not HTTP responses). Request handler errors go through `causeResponse` (HTTP response). These are two separate error domains.

## model.json — Split-Brain Across Four Writers

`~/.local/state/opencode/model.json` is a shared file written from **4 code paths** using 2 I/O paradigms:
- **`variant.shared.ts`** (Effect async + sync fs) — writes `variant` and `subagentModel` fields
- **`tui/src/context/local.tsx:save()`** (async Promise) — writes `recent`, `favorite`, `variant`; catch branch drops `subagentModel`
- **`tui/src/context/local.tsx:syncModelJson()`** (async Promise, separate writeQueue) — writes `subagentModel`

The TUI has TWO independent writers to `model.json` with no cross-queue coordination (TOCTOU race within a single file).

**Cross-package coupling**: A file at `Global.Path.state/model.json` couples the `opencode` CLI run command, the TUI, and the provider default-model resolver (`provider.ts:1889`). Adding a new field to this file requires updating ALL four writers, plus the consumers in `tool/task.ts` and `provider.ts`.

### Implicit filesystem contract: tool/task.ts reads model.json via raw fs

`resolveUserSubagentModel` at `tool/task.ts:92` does a raw `JSON.parse(await fs.readFile(file, "utf-8"))` on the same file. There is no typed interface between the four writers and this consumer. A key rename (e.g. `subagentModel` → `subagent_model`) silently returns `undefined` with only a debug log.

## Build Commands

### Build opencode binary
```bash
cd packages/opencode && OPENCODE_VERSION=1.2.1 bun run build --skip-embed-web-ui --skip-install --single
```

### Typecheck single package
```bash
cd packages/opencode && bun run typecheck
cd packages/core && bun run typecheck
```

### Run tests
```bash
cd packages/opencode && bun test --timeout 30000
```

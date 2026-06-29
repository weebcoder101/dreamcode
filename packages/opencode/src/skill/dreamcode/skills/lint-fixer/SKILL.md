---
name: lint-fixer
description: Mandatory post-implementation lint and type-checking skill that runs after ANY code change, bug fix, new feature, refactor, API change, or configuration modification. Ensures all TypeScript type errors, Effect-TS ecosystem issues, and lint errors are resolved. Use after every implementation that modifies source files.
chains_with: [automated-learning]
---

# Lint Fix Skill — Mandatory Post-Implementation Pipeline (TypeScript/Effect-TS)

## Purpose
This skill runs **MANDATORILY** after implementation. It ensures:
1. All TypeScript type errors resolved (`tsc --noEmit`)
2. All Effect-TS ecosystem type errors fixed
3. No new lint/type issues introduced
4. Code follows the project's strict quality standards

## Workflow — 5 Iterative Loops

### Loop 1: TypeScript Type Check
```
RUN: bun run typecheck (or tsc --noEmit --project packages/opencode/tsconfig.json)
IF errors found:
  - Categorize by error family (see Effect-TS Type Error Families below)
  - Apply automated fix pattern for each family
  - Re-run check after fixes
```

### Effect-TS Type Error Families & Automated Fixes

| Error Family | Detection Pattern | Automated Fix |
|---|---|---|
| `Context.Tag` unsatisfied | `Effect<A, E, R>` where R includes missing service | Add `Layer.provide(Missing.layer)` to composition |
| `Schema.decodeUnknown` mismatch | `Schema.decodeUnknown(MyClass)` type arg ≠ passed value | Wrap in `Schema.decodeUnknownSync` with `try/catch` |
| `Effect.gen` inference failure | `yield* service.method()` — type not inferred | Add explicit type annotation: `yield* service.method() as Effect<ReturnType>` |
| ManagedRuntime type error | `ManagedRuntime.make(layer)` — provider mismatch | Check layer composition order; ensure all deps provided |
| `Effect.catchAll` (v4 beta) | `Effect.catchAll(...)` — doesn't exist in v4 | Replace with `Effect.catch(...)` (catches all including defects) |
| `Effect.fork` without scope | `Effect.fork(...)` — doesn't exist in v4 | Use `Effect.forkIn(scope)` |
| `Schema.Struct` multi-field | `Schema.Struct({...})` — verbose | Use `Schema.Class` for multi-field data shapes |
| Missing return type on `Effect.fn` | `Effect.fn("name")(function*(){...})` without return | Add type params: `Effect.fn("name")(function*(in: Input): Effect.Effect<Output>)` |
| `any` type propagation | `: any` in type position | Replace with `unknown` + narrow with type guard |

### Loop 2: Biome / ESLint Check & Fix
```
RUN: npx biome check --fix packages/opencode/src/
   OR: npx eslint --fix packages/opencode/src/
IF errors found:
  - Auto-fix with --fix flag
  - Categorize remaining errors (unused vars, missing deps, etc.)
```

### Loop 3: Import Order & Unused Imports
```
RUN: npx biome check --fix --formatter-enabled=true packages/opencode/src/
RUN: npx ts-prune -p packages/opencode/tsconfig.json
IF unused exports detected:
  - Remove or prefix with `_`
```

### Loop 4: Complex Pattern Detection (Effect-TS)
```
SCAN for complex patterns that commonly cause issues:
- Layer circular dependency (A → B → A)
- Missing Scope in Effect.gen (yield* Effect.forkIn needs Scope.Scope)
- Effect.catchCause without proper Cause matching
- Schema decode without error boundary
- Eq.filter without proper type narrowing

IF found:
  - Fix with proper patterns
  - Document in this skill for future detection
```

### Loop 5: NEURO Integration — Full Validation
```
INVOKE NEURO with the complete context:
- Current file changes
- All type fixes applied
- Any remaining issues

NEURO REVIEW:
- Validate no regressions introduced
- Check for potential bugs in the fixes
- Ensure code quality maintained
- Provide architectural sign-off

IF NEURO approves:
  - Skill complete, ready to respond to user
IF NEURO rejects:
  - Iterate back to Loop 1 with NEURO feedback
```

## Key Fix Patterns

### Effect-TS Type Fix Patterns
```typescript
// Fix: Effect.catchAll doesn't exist in v4 — use Effect.catch
// ❌ old
pipe(effect, Effect.catchAll(handler))
// ✅ new
pipe(effect, Effect.catch(handler))  // catches all errors including defects
pipe(effect, Effect.catchTag("SomeTag", handler))  // catches tagged errors only

// Fix: Effect.fork needs Scope — use Effect.forkIn
// ❌ old
yield* Effect.fork(effect)
// ✅ new
const scope = yield* Scope.Scope
yield* Effect.forkIn(effect, scope)

// Fix: Schema multi-field — use Class not Struct
// ❌ old
const MySchema = Schema.Struct({ name: Schema.String, age: Schema.Number })
// ✅ new
class MySchema extends Schema.Class<MySchema>("MySchema")({
  name: Schema.String,
  age: Schema.Number,
}) {}

// Fix: Layer dependency missing
// ❌ old — MissingFoo not provided
const layer = Layer.effect(Service, Effect.gen(function* () {
  const foo = yield* MissingFoo  // Effect<A, E, R> where R requires MissingFoo
}))
// ✅ new
const layer = Layer.effect(Service, Effect.gen(function* () {
  const foo = yield* MissingFoo
})).pipe(Layer.provide(MissingFoo.defaultLayer))

// Fix: Tag identity
// ❌ old — Service.toString() doesn't exist in v4
SomeService.toString()
// ✅ new
SomeService.key
```

### Bun-built Binary Patterns
```typescript
// Bun 1.3.x compiled binaries: replace ChildProcess + Stream with Bun.spawn
// ❌ old (breaks in compiled binary)
const child = yield* ChildProcess.make({ command: "python3", args, stdin: Stream.make(bytes) })
// ✅ new
const proc = Bun.spawn(["python3", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
const writer = proc.stdin.getWriter()
await writer.write(bytes); await writer.close()
const text = await proc.stdout.text()
await proc.exited
```

## Files to Always Check
- packages/opencode/src/**/*.ts
- packages/opencode/test/**/*.ts
- packages/function/src/**/*.ts
- All frontend JavaScript/JSX/TSX files
- All test files

## Execution Command
```bash
bun run typecheck 2>&1 || npx tsc --noEmit --project packages/opencode/tsconfig.json
npx biome check --fix packages/opencode/src/
```

## Exit Criteria
- `tsc --noEmit`: Success: no issues found
- All Effect-TS v4 patterns correct (no catchAll, no standalone fork)
- No new lint warnings introduced
- NEURO has provided sign-off (for Loop 5)

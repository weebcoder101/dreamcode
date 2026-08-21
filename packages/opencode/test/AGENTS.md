# Test Infrastructure Learnings

## testEffect Layer Building

- `testEffect(layer)` builds layers with a fresh `memoMap` per test.
- `Layer.mergeAll` shares the memoMap — `Layer.provide` inside `defaultLayer` still creates new instances that shadow outer provides.
- To share instances across layers, use `Layer.provideMerge` at the outer level or avoid `defaultLayer` entirely.

## Fixture Isolation

- `withTmpdirInstance` / `provideInstanceEffect` only provides `InstanceRef` — does **NOT** isolate `HOME`, `XDG_CONFIG_HOME`, etc.
- Tests read real `~/.config/dreamcode/` files (auth.key, config.json) unless env vars are overridden.
- Config's `loadInstanceState` reads auth.json — if it contains `wellknown` provider, real network fetch occurs in tests.

## Debug Patterns

- `DBG` prefix logs for tracing nested Effect execution.
- `Effect.timeout("4 seconds")` on test calls to catch hangs.
- Label caches with `labelCache` in `instance-state.ts` to track cache identity across layer boundaries.
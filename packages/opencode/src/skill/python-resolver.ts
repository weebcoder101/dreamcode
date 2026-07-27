/**
 * Cross-platform Python resolver.
 *
 * On Linux/macOS: uses `python3` (or `python` as fallback)
 * On Windows: uses `py -3` (Python Launcher), then `python`, then `python3`
 *
 * This module also resolves the path to Python scripts that are installed
 * alongside the dreamcode binary.
 */
import { existsSync, statSync, readdirSync, appendFileSync, mkdirSync, writeFileSync, mkdtempSync, chmodSync, unlinkSync, rmdirSync, realpathSync } from "fs"
import { join, dirname, sep, resolve, isAbsolute } from "path"
import { homedir } from "os"

/**
 * Normalize a home directory path on Windows.
 * Git for Windows sets HOME to POSIX-style paths like /c/Users/username,
 * which break existsSync() checks in the rest of the resolver.
 */
function normalizeHome(raw: string): string {
  if (process.platform === "win32" && raw.startsWith("/")) {
    const match = raw.match(/^\/([a-zA-Z])(\/.*)$/)
    if (match) return `${match[1]}:${match[2]}`
  }
  return raw
}

/** Single source of truth for user home directory across the skill subsystem. */
export const HOME = normalizeHome(process.env.HOME || process.env.USERPROFILE || homedir() || "/tmp")

/** File-based debug logger. Activated by DREAMCODE_DEBUG=1 env var. */
export function debugLog(...args: unknown[]): void {
  if (process.env.DREAMCODE_DEBUG !== "1") return
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`
  // Write to stderr so it's visible in terminal for --print-logs / --log-level DEBUG
  console.error(line)
  // Also write to a file for post-mortem analysis
  try {
    const logPath = join(HOME, ".dreamcode", "logs", "python-resolver.log")
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, line + "\n")
  } catch (e) {
    console.warn("[python-resolver] debugLog write failed:", String(e))
  }
}

export function isWindows(): boolean {
  return process.platform === "win32"
}

/**
 * Write a prompt string to a temporary file and return the file path.
 * This avoids leaking the prompt via CLI arguments in process listings.
 *
 * @param prompt - The prompt text to write
 * @param cwd - Working directory to use for the temp base path
 * @param prefix - Directory name prefix (e.g. "sg-", "ce-", "tp-")
 * @returns The absolute path to the temp file
 * @throws If temp file creation fails
 */
export function writePromptToTmpFile(prompt: string, cwd: string, prefix: string): string {
  const tmpBase = isWindows()
    ? join(process.env.TEMP || process.env.TMP || HOME, "dreamcode")
    : join(cwd, ".dreamcode", "tmp")
  mkdirSync(tmpBase, { recursive: true })
  const tmpDir = mkdtempSync(join(tmpBase, prefix))
  if (!isWindows()) chmodSync(tmpDir, 0o700)
  const tmpFile = join(tmpDir, "prompt.txt")
  writeFileSync(tmpFile, prompt, "utf-8")
  if (!isWindows()) chmodSync(tmpFile, 0o600)
  return tmpFile
}

/**
 * Clean up a temporary prompt file and its parent directory.
 * Safe to call even if the file or directory doesn't exist (errors are swallowed).
 */
export function cleanupTmpFile(tmpFile: string): void {
  if (!tmpFile) return
  try { unlinkSync(tmpFile) } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("[python-resolver] cleanupTmpFile failed to unlink", tmpFile, e)
    }
  }
  try { rmdirSync(dirname(tmpFile)) } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("[python-resolver] cleanupTmpFile failed to rmdir", dirname(tmpFile), e)
    }
  }
}

/**
 * Resolve the Python command for the current platform.
 * Returns the command and arguments prefix to use with Bun.spawn.
 */
export function resolvePythonCommand(): string {
  // Check environment variable first (user override)
  const envPython = process.env.PYTHON_PATH || process.env.DREAMCODE_PYTHON
  if (envPython) return envPython

  if (isWindows()) {
    // Windows: `py` (Python Launcher) is the recommended command
    // If `py` fails at runtime (e.g. WSL interop, no Python Launcher),
    // callers should fall back via resolvePythonCommands()
    return "py"
  }

  // Unix: `python3` is standard, `python` as fallback
  return "python3"
}

/**
 * Returns all candidate Python commands for the current platform in priority order.
 * Callers can try each in sequence if the primary command fails.
 */
export function resolvePythonCommands(): string[] {
  const envPython = process.env.PYTHON_PATH || process.env.DREAMCODE_PYTHON
  if (envPython) return [envPython]

  if (isWindows()) {
    // Windows: py launcher first, then python/python3 variants
    return ["py", "python", "python3"]
  }

  // Unix: python3 first, python as fallback
  return ["python3", "python"]
}

/**
 * Get the arguments to pass for Python version specification on Windows.
 * For `py`, we need `-3` flag. For `python`/`python3`, no extra args needed.
 *
 * @param cmd - The actual Python command being used (from fallback loop).
 *              Falls back to resolvePythonCommand() if omitted.
 */
export function getPythonArgs(cmd?: string): string[] {
  const effectiveCmd = cmd || resolvePythonCommand()
  if (isWindows() && effectiveCmd === "py") {
    return ["-3"]
  }
  return []
}

// ---------------------------------------------------------------------------
// Skill Directory Name Aliases
// ---------------------------------------------------------------------------
// The source tree and deployed directory now use consistent short names (api, data, etc.).
// The alias map is maintained as a compatibility layer for any remaining
// canonical-name lookups. All aliases are identity mappings.

const SKILL_DIR_ALIASES: Record<string, string> = {
  // Sensor-gate canonical name → registered SKILL.md name
  // The sensor gate emits short names (api, data, git, ...) but SKILL.md
  // frontmatter may use descriptive names (api-design, data-science, ...).
  // This mapping bridges the gap so skillService.require() finds the right skill.
  "api": "api",
  "data": "data",
  "git": "git",
  "product": "product",
  "python": "python",
  "quantum": "quantum",
}

/**
 * Resolve a skill name to its actual registered skill name.
 * Existence-first: prefer whatever directory actually exists on disk (canonical
 * name, then aliased name), so resolution is robust to layout divergence between
 * the bundled binary tree and the deployed global config skill tree.
 */
export function resolveSkillDirName(canonicalName: string): string {
  const skillsDir = resolveSkillsDir()
  if (skillsDir) {
    const direct = join(skillsDir, canonicalName)
    try {
      if (existsSync(direct) && statSync(direct).isDirectory()) return canonicalName
    } catch { /* fall through */ }

    const aliased = SKILL_DIR_ALIASES[canonicalName]
    if (aliased) {
      const aliasedPath = join(skillsDir, aliased)
      try {
        if (existsSync(aliasedPath) && statSync(aliasedPath).isDirectory()) return aliased
      } catch { /* fall through */ }
    }
  }

  const aliased = SKILL_DIR_ALIASES[canonicalName]
  if (aliased) return aliased
  return canonicalName
}

/**
 * Resolve the skills directory path.
 *
 * SINGLE SOURCE OF TRUTH: There is ONE canonical skills directory per install.
 * The resolution order is:
 *
 * 1. DREAMCODE_SKILLS_DIR env var (explicit override)
 * 2. Binary-bundled skills dir (dirname(process.execPath)/skills) — for compiled binaries
 * 3. Global config dir (~/.config/dreamcode/skills) — for npm/bun installs
 * 4. Project-local dir (./.dreamcode/skills) — for development within the dreamcode repo
 *
 * The old candidates (~/.dreamcode/skills, ~/.opencode/skills, ~/.config/opencode/skills,
 * ./opencode/skills) have been REMOVED to eliminate the confusion of multiple parallel
 * skill directories. Users running from the dreamcode repo should use ./packages/opencode/src/skill/dreamcode/skills
 * (the source tree path) or set DREAMCODE_SKILLS_DIR explicitly.
 */
export function resolveSkillsDir(): string {
  // Environment variable override (highest priority)
  const envSkillsDir = process.env.DREAMCODE_SKILLS_DIR
  if (envSkillsDir) {
    try {
      if (existsSync(envSkillsDir) && statSync(envSkillsDir).isDirectory()) return envSkillsDir
    } catch (e) {
      debugLog(`[python-resolver] DREAMCODE_SKILLS_DIR=${envSkillsDir} not accessible:`, e)
    }
  }

  const candidates = [
    // 1. Binary-bundled skills (release artifact): skills/ is copied next to the binary during build
    join(dirname(process.execPath), "skills"),
    // 2. Global config dir (XDG): ~/.config/dreamcode/skills
    join(HOME, ".config", "dreamcode", "skills"),
    // 3. Legacy config dir: ~/.dreamcode/skills (backward compat for old installs)
    join(HOME, ".dreamcode", "skills"),
    // 4. Project-local dir: ./.dreamcode/skills (for development within dreamcode repo)
    join(process.cwd(), ".dreamcode", "skills"),
    // 5. Source tree path (for development / unbundled installs)
    join(process.cwd(), "packages", "opencode", "src", "skill", "dreamcode", "skills"),
  ]
  for (const dir of candidates) {
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        // Verify directory has at least one subdirectory with a SKILL.md file.
        // Empty dirs (e.g. ~/.config/dreamcode/skills/ created by a prior run
        // that exited before syncing) should NOT be accepted — they'd cause
        // getAvailableSkills() to return [] and all skill lookups to fail.
        const entries = readdirSync(dir)
        const hasContent = entries.some((entry) => {
          const subdir = join(dir, entry)
          try { return statSync(subdir).isDirectory() && existsSync(join(subdir, "SKILL.md")) } catch { return false }
        })
        if (hasContent) {
          debugLog("[python-resolver] found skills dir:", dir)
          return dir
        }
        debugLog("[python-resolver] skills dir exists but empty:", dir)
        continue // Don't stop at empty dirs — check next candidate
      }
      debugLog("[python-resolver] skills dir not found:", dir)
    } catch (e) {
      debugLog("[python-resolver] error checking skills dir:", dir, e)
    }
  }
  debugLog("[python-resolver] NO skills directory found among candidates — falling back to first candidate")
  // v1.2.9 behavior: always return first candidate even if nonexistent.
  // This ensures resolveScript always has at least one candidate path to check,
  // preventing silent failures when the skills dir exists but other checks fail.
  return candidates[0] ?? ""
}

/**
 * Resolve a Python script by relative path from the skills directory.
 * Returns the absolute path if found, undefined otherwise.
 */
export function resolveScript(relativePath: string): string | undefined {
  const skillsDir = resolveSkillsDir()
  const candidates = [
    ...(skillsDir ? [join(skillsDir, relativePath)] : []),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        debugLog("[python-resolver] found script:", p)
        return p
      }
      debugLog("[python-resolver] script not found:", p)
    } catch (e) {
      debugLog("[python-resolver] error checking script path:", p, e)
    }
  }
  debugLog("[python-resolver] script NOT FOUND:", relativePath)
  return undefined
}

// ---------------------------------------------------------------------------
// Path Validation (moved from chain-executor.ts to break circular dependency)
// ---------------------------------------------------------------------------

/**
 * Check if a realpath falls under an allowed prefix.
 * Normalizes the prefix with a trailing separator to prevent sibling-directory
 * escape (e.g. prefix "/skills" should NOT match "/skills-evil").
 */
export function isUnderPrefix(realpath: string, allowedPrefix: string): boolean {
  const normalized = allowedPrefix.endsWith(sep) ? allowedPrefix : allowedPrefix + sep
  return realpath === allowedPrefix || realpath.startsWith(normalized)
}

/**
 * Validate that a script path is inside one of the allowed skills directories.
 * Resolves symlinks before checking to prevent sandbox escape.
 *
 * Exported from python-resolver.ts so all skill subprocess modules can share it
 * without depending on chain-executor.ts.
 */
export function validateScriptPath(resolved: string, cwd?: string): boolean {
  if (!resolved || !isAbsolute(resolved)) return false
  let realpath: string
  try {
    realpath = realpathSync(resolved)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== "ENOENT") {
      console.warn("[python-resolver] Unexpected realpath error", resolved, error)
    }
    // Check `..` in resolved BEFORE resolve() which normalizes them away.
    if (resolved.includes("..")) return false
    realpath = resolve(resolved)
  }
  const skillsDir = resolveSkillsDir()
  const allowedGlobal = skillsDir ? resolve(skillsDir) : null
  const allowedBinary = resolve(dirname(process.execPath), "skills")
  const allowedXdg = resolve(HOME, ".config", "dreamcode", "skills")
  const allowedLegacy = resolve(HOME, ".dreamcode", "skills")
  const allowedProject = resolve(cwd ?? process.cwd(), ".dreamcode", "skills")
  return (
    (allowedGlobal !== null && isUnderPrefix(realpath, allowedGlobal)) ||
    isUnderPrefix(realpath, allowedBinary) ||
    isUnderPrefix(realpath, allowedXdg) ||
    isUnderPrefix(realpath, allowedLegacy) ||
    isUnderPrefix(realpath, allowedProject)
  )
}

// ---------------------------------------------------------------------------
// Shared Subprocess Environment Allowlist
// ---------------------------------------------------------------------------

/**
 * Base environment variables allowed in subprocess spawns.
 *
 * Using an allowlist (not a denylist) prevents accidental credential leakage
 * via inherited environment variables. Add new variables here rather than
 * duplicating env blocks across spawn sites.
 *
 * Each spawn site spreads this and adds site-specific overrides:
 * ```
 * env: { ...BASE_SUBPROCESS_ENV, PROJECT_ROOT: cwd }
 * ```
 *
 * NOTE: The NEURO harness in sensor-gate.ts also passes NEURO_API_KEY — that
 * is intentional and site-specific (NEURO backend auth).
 */
export const BASE_SUBPROCESS_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  PYTHONPATH: process.env.PYTHONPATH ?? "",
}



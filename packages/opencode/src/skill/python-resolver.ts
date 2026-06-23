/**
 * Cross-platform Python resolver.
 *
 * On Linux/macOS: uses `python3` (or `python` as fallback)
 * On Windows: uses `py -3` (Python Launcher), then `python`, then `python3`
 *
 * This module also resolves the path to Python scripts that are installed
 * alongside the dreamcode binary.
 */
import { existsSync, statSync, appendFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
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
  } catch {}
}

export function isWindows(): boolean {
  return process.platform === "win32"
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

/**
 * Resolve the skills directory path.
 * Checks multiple candidate locations in order.
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
    // Check if scripts are bundled alongside the binary itself (release artifact)
    ...(isWindows() ? [
      join(dirname(process.execPath), "skills"),
      join(HOME, "AppData", "Roaming", "dreamcode", "skills"),
    ] : [
      join(dirname(process.execPath), "skills"),
    ]),
    // Standard XDG/Unix paths
    join(HOME, ".config", "dreamcode", "skills"),
    join(HOME, ".dreamcode", "skills"),
    join(HOME, ".config", "opencode", "skills"),
    join(HOME, ".opencode", "skills"),
    // Project-local paths
    join(process.cwd(), ".dreamcode", "skills"),
    join(process.cwd(), ".opencode", "skills"),
  ]
  for (const dir of candidates) {
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        debugLog("[python-resolver] found skills dir:", dir)
        return dir
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
    join(process.cwd(), ".dreamcode", "skills", relativePath),
    join(process.cwd(), ".opencode", "skills", relativePath),
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



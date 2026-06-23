/**
 * Cross-platform Python resolver.
 *
 * On Linux/macOS: uses `python3` (or `python` as fallback)
 * On Windows: uses `py -3` (Python Launcher), then `python`, then `python3`
 *
 * This module also resolves the path to Python scripts that are installed
 * alongside the dreamcode binary.
 */
import { existsSync, statSync } from "fs"
import { join, dirname } from "path"

/** Single source of truth for user home directory across the skill subsystem. */
export const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"

function isWindows(): boolean {
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
    // Windows: try `py -3` (Python Launcher), then `python`, then `python3`
    // We return just the base command; callers handle args
    return "py"
  }

  // Unix: `python3` is standard, `python` as fallback
  return "python3"
}

/**
 * Get the arguments to pass for Python version specification on Windows.
 * For `py`, we need `-3` flag. For `python`/`python3`, no extra args needed.
 */
export function getPythonArgs(): string[] {
  if (isWindows() && resolvePythonCommand() === "py") {
    return ["-3"]
  }
  return []
}

/**
 * Resolve the skills directory path.
 * Checks multiple candidate locations in order.
 */
export function resolveSkillsDir(): string {
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
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir
    } catch (e) {
      console.warn(`[python-resolver] error checking skills dir ${dir}:`, e)
    }
  }
  console.warn(
    "[python-resolver] no skills directory found among candidates; chain executor and sensor gate scripts will be unavailable",
  )
  return ""
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
      if (existsSync(p)) return p
    } catch (e) {
      console.warn(`[python-resolver] error checking script path ${p}:`, e)
    }
  }
  return undefined
}



/**
 * Cross-platform Python resolver.
 *
 * On Linux/macOS: uses `python3` (or `python` as fallback)
 * On Windows: uses `py -3` (Python Launcher), then `python`, then `python3`
 *
 * This module also resolves the path to Python scripts that are installed
 * alongside the dreamcode binary.
 */
import * as fs from "fs"
import * as path from "path"

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"
const IS_WINDOWS = process.platform === "win32"

/**
 * Resolve the Python command for the current platform.
 * Returns the command and arguments prefix to use with Bun.spawn.
 */
export function resolvePythonCommand(): string {
  // Check environment variable first (user override)
  const envPython = process.env.PYTHON_PATH || process.env.DREAMCODE_PYTHON
  if (envPython) return envPython

  if (IS_WINDOWS) {
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
  if (IS_WINDOWS && resolvePythonCommand() === "py") {
    return ["-3"]
  }
  return []
}

/**
 * Build the full command array for Bun.spawn to execute a Python script.
 * Handles platform-specific Python resolution.
 */
export function buildPythonArgs(scriptPath: string, scriptArgs: string[]): string[] {
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  return [pythonCmd, ...versionArgs, scriptPath, ...scriptArgs]
}

/**
 * Resolve the skills directory path.
 * Checks multiple candidate locations in order.
 */
export function resolveSkillsDir(): string {
  const candidates = [
    // Check if scripts are bundled alongside the binary itself (release artifact)
    ...(process.platform === "win32" ? [
      path.join(path.dirname(process.execPath), "skills"),
      path.join(HOME, "AppData", "Roaming", "dreamcode", "skills"),
    ] : [
      path.join(path.dirname(process.execPath), "skills"),
    ]),
    // Standard XDG/Unix paths
    path.join(HOME, ".config", "dreamcode", "skills"),
    path.join(HOME, ".dreamcode", "skills"),
    path.join(HOME, ".config", "opencode", "skills"),
    path.join(HOME, ".opencode", "skills"),
    // Project-local paths
    path.join(process.cwd(), ".dreamcode", "skills"),
    path.join(process.cwd(), ".opencode", "skills"),
  ]
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
    } catch (e) {
      console.warn(`[python-resolver] error checking skills dir ${dir}:`, e)
    }
  }
  return candidates[0]
}

/**
 * Resolve a Python script by relative path from the skills directory.
 * Returns the absolute path if found, undefined otherwise.
 */
export function resolveScript(relativePath: string): string | undefined {
  const skillsDir = resolveSkillsDir()
  const candidates = [
    path.join(skillsDir, relativePath),
    path.join(process.cwd(), ".dreamcode", "skills", relativePath),
    path.join(process.cwd(), ".opencode", "skills", relativePath),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {
      console.warn(`[python-resolver] error checking script path ${p}:`, e)
    }
  }
  return undefined
}

/**
 * Check if Python is available on the system.
 * Returns true if a Python command can be found.
 */
export function isPythonAvailable(): boolean {
  try {
    const { execFileSync } = require("child_process")
    execFileSync(resolvePythonCommand(), [...getPythonArgs(), "--version"], {
      stdio: "pipe",
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

import { Effect } from "effect"
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, statSync } from "fs"
import { join, basename } from "path"
import { Global } from "@opencode-ai/core/global"
import { homedir } from "os"

// Backward compatibility: check old ~/.dreamcode/evolution path first,
// then fall back to XDG data path (~/.local/share/dreamcode/evolution).
const oldEvolutionDir = join(homedir(), ".dreamcode", "evolution")
const EVOLUTION_DIR = existsSync(oldEvolutionDir) ? oldEvolutionDir : join(Global.Path.data, "evolution")
const TASTE_LOG = join(EVOLUTION_DIR, "taste.jsonl")
const PROFILE_FILE = join(EVOLUTION_DIR, "profile.json")

export interface TasteSignal {
  timestamp: number
  sessionID: string
  domain: string
  spawnDecision: "spawned" | "skipped" | "explicit-spawn"
  suggestedCount: number
  actualCount: number
  personaNames: string[]
  gateMode: string
  chainCount: number
  skipReason?: string
}

export interface CodebaseProfile {
  technologies: string[]
  packageManagers: string[]
  languages: string[]
  testFrameworks: string[]
  lastAnalyzed: number
}

function ensureDir() {
  // P1-06: log instead of silently swallowing — taste signals and the
  // codebase profile are user-visible features, and silent loss is
  // worse than a logged warning.
  try {
    mkdirSync(EVOLUTION_DIR, { recursive: true })
  } catch (err) {
    console.warn("[prompt-taste] failed to create evolution dir:", String(err))
  }
}

export function recordTaste(signal: TasteSignal) {
  ensureDir()
  try {
    appendFileSync(TASTE_LOG, JSON.stringify(signal) + "\n")
  } catch (err) {
    // P1-06: was `catch {}` — surface the failure. Taste signals are
    // a debugging aid and silent loss is worse than a logged warning.
    console.warn("[prompt-taste] failed to record taste signal:", String(err))
  }
}

function readLines(path: string, max: number): string[] {
  try {
    if (!existsSync(path)) return []
    const content = readFileSync(path, "utf-8").trim()
    if (!content) return []
    return content.split("\n").filter(Boolean).slice(-max)
  } catch {
    return []
  }
}

function readProfile(): CodebaseProfile | null {
  try {
    if (!existsSync(PROFILE_FILE)) return null
    return JSON.parse(readFileSync(PROFILE_FILE, "utf-8"))
  } catch {
    return null
  }
}

export { readProfile }

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".cache", "target", "build", ".next", ".turbo"])

function detectCodebase(projectRoot: string): CodebaseProfile {
  const techs = new Set<string>()
  const pms = new Set<string>()
  const langs = new Set<string>()
  const tests = new Set<string>()

  function walk(dir: string, depth = 0) {
    if (depth > 2) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e)) continue
      const full = join(dir, e)
      let stat: any
      try { stat = statSync(full) } catch { continue }
      if (stat.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      const name = basename(e)
      const ext = name.includes(".") ? name.split(".").pop() ?? "" : ""
      if (name === "package.json") { pms.add("npm"); langs.add("TypeScript") }
      else if (name === "Cargo.toml") { pms.add("cargo"); langs.add("Rust") }
      else if (name === "go.mod") { pms.add("go"); langs.add("Go") }
      else if (name === "pyproject.toml" || name === "setup.py") { pms.add("pip"); langs.add("Python") }
      else if (name === "Gemfile") { pms.add("bundler"); langs.add("Ruby") }
      else if (name === "tsconfig.json") { langs.add("TypeScript") }
      else if (name === "vitest.config.ts" || name === "jest.config.ts" || name === ".mocharc.yml") tests.add("Unit")
      else if (name === "playwright.config.ts") tests.add("E2E")
      else if (name === "Dockerfile") techs.add("Docker")
      else if (name === "docker-compose.yml" || name === "compose.yaml") techs.add("Docker")
      else if (ext === "rs") langs.add("Rust")
      else if (ext === "ts" || ext === "tsx") langs.add("TypeScript")
      else if (ext === "py") langs.add("Python")
      else if (ext === "go") langs.add("Go")
      else if (ext === "rb") langs.add("Ruby")
      else if (ext === "zig") langs.add("Zig")
    }
  }

  try { walk(projectRoot) } catch { }
  return {
    technologies: [...techs],
    packageManagers: [...pms],
    languages: [...langs],
    testFrameworks: [...tests],
    lastAnalyzed: Date.now(),
  }
}

export function refreshProfile(projectRoot: string) {
  const profile = detectCodebase(projectRoot)
  ensureDir()
  try {
    writeFileSync(PROFILE_FILE, JSON.stringify(profile))
  } catch (err) {
    // P1-06: was `catch {}` — log the failure so callers can detect it.
    console.warn("[prompt-taste] failed to write profile.json:", String(err))
  }
  return profile
}

export function summarizeTaste(): string {
  const tasteLines = readLines(TASTE_LOG, 200)
  const profile = readProfile()
  const parts: string[] = []

  if (profile && profile.languages.length > 0) {
    parts.push(
      `<codebase-profile>\n` +
      `Languages: ${profile.languages.join(", ")}\n` +
      `Stack: ${profile.technologies.join(", ")}\n` +
      `Build: ${profile.packageManagers.join(", ")}\n` +
      `Tests: ${profile.testFrameworks.join(", ")}\n` +
      `</codebase-profile>`,
    )
  }

  if (tasteLines.length > 0) {
    const decisions: TasteSignal[] = tasteLines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const spawnCount = decisions.filter(d => d.spawnDecision === "spawned" || d.spawnDecision === "explicit-spawn").length
    const skipCount = decisions.filter(d => d.spawnDecision === "skipped").length
    const domains = new Map<string, number>()
    for (const d of decisions) {
      if (d.domain) domains.set(d.domain, (domains.get(d.domain) ?? 0) + 1)
    }
    const top = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(3)

    if (spawnCount + skipCount > 0) {
      const pct = Math.round(spawnCount / Math.max(1, spawnCount + skipCount) * 100)
      parts.push(
        `<taste-profile>\n` +
        `Total classifications: ${spawnCount + skipCount}\n` +
        `Spawn rate: ${pct}% (${spawnCount} spawned, ${skipCount} skipped)\n` +
        (top.length > 0 ? `Top domains: ${top.map(([d, c]) => `${d}(${c})`).join(", ")}\n` : "") +
        `</taste-profile>`,
      )
    }
  }

  return parts.join("\n")
}

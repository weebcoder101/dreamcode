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
const TASTE_EVENTS = join(EVOLUTION_DIR, "taste-events.jsonl")
const TASTE_PROFILE = join(EVOLUTION_DIR, "taste-profile.json")
const PROFILE_FILE = join(EVOLUTION_DIR, "profile.json")

// ─── Legacy signal (sensor-gate spawn decisions) ────────────────────────────

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

// ─── Episodic taste events (the real signal) ────────────────────────────────

export type TasteEventType =
  | "explicit"    // "I prefer X", "always use Y" — highest confidence
  | "correction"  // "no, do X instead", user rejecting agent output
  | "tool-use"    // which tools the user's session actually invokes
  | "comm-style"  // verbosity, emoji, technical depth observed in user text
  | "workflow"    // task-breakdown, session patterns

export interface TasteEvent {
  ts: number
  sessionID: string
  type: TasteEventType
  raw: string
  confidence: number // 0..1; explicit=1.0, inferred lower
  context?: string
}

export type TasteCategory = "communication" | "code-style" | "tools" | "quality" | "workflow"

export interface TastePreference {
  id: string // stable hash of (category, key)
  category: TasteCategory
  key: string
  value: string
  evidence: number // accumulated weight
  firstSeen: number
  lastSeen: number
  supersededBy?: string
  enforced?: boolean
}

export interface TasteProfile {
  version: number
  updated: number
  global: TastePreference[]
}

function ensureDir() {
  try { mkdirSync(EVOLUTION_DIR, { recursive: true }) } catch { }
}

// ─── Low-level IO ───────────────────────────────────────────────────────────

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

function appendLine(path: string, line: string) {
  ensureDir()
  try { appendFileSync(path, line + "\n") } catch { }
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

function readTasteProfile(): TasteProfile | null {
  try {
    if (!existsSync(TASTE_PROFILE)) return null
    return JSON.parse(readFileSync(TASTE_PROFILE, "utf-8"))
  } catch {
    return null
  }
}

// ─── Signal capture ─────────────────────────────────────────────────────────

/** Record a legacy sensor-gate signal (kept for backward compat). */
export function recordTaste(signal: TasteSignal) {
  appendLine(TASTE_LOG, JSON.stringify(signal))
}

/**
 * Record an episodic taste event — the raw material the consolidation pass
 * densifies into preferences. Cheap (single append), safe to call anywhere.
 */
export function recordTasteEvent(event: TasteEvent) {
  appendLine(TASTE_EVENTS, JSON.stringify(event))
}

// ─── Explicit preference extraction (heuristic, no LLM needed) ─────────────

const EXPLICIT_PATTERNS: [RegExp, TasteCategory, string][] = [
  [/i (?:prefer|like|want|love|need) (?:to use |using )?([a-z0-9_.-]+)/i, "tools", "preferred-tool"],
  [/always (?:use|write|add|include) ([a-z0-9_.-]+)/i, "code-style", "always"],
  [/never (?:use|write|add|include) ([a-z0-9_.-]+)/i, "quality", "never"],
  [/don'?t (?:use|write|add|include) ([a-z0-9_.-]+)/i, "quality", "avoid"],
  [/stop (?:using|doing) ([a-z0-9_.-]+)/i, "quality", "avoid"],
  [/be more (concise|verbose|detailed|thorough|explicit)/i, "communication", "verbosity"],
  [/be less (concise|verbose|detailed|thorough|explicit)/i, "communication", "verbosity"],
  [/no (?:emoji|emojis|jokes)/i, "communication", "emoji"],
  [/use (?:tabs|spaces)/i, "code-style", "indentation"],
  [/camel[Cc]ase|snake_case|kebab-case/i, "code-style", "naming"],
  [/add (?:more )?tests/i, "quality", "tests"],
  [/write (?:a |an )?(?:unit )?test/i, "quality", "tests"],
  [/always (?:add|include) (?:types|type hints|typescript types)/i, "code-style", "typing"],
  [/never (?:use )?(?:any|unknown) /i, "code-style", "typing"],
  [/explain (?:your reasoning|why|the reasoning)/i, "communication", "reasoning"],
  [/keep (?:it|it short|it concise|it brief)/i, "communication", "verbosity"],
]

const CORRECTION_PATTERNS: RegExp[] = [
  /^(no|nope|not that|wrong|that'?s not|stop|don'?t do that|undo|revert|actually)/i,
  /^instead (?:do|use|try|make it)/i,
  /^(please )?(?:redo|redo it|try again|different)/i,
  /\b(don'?t|never|stop) (?:use|do|write|add) (that|this|it|the)/i,
]

/** Extract explicit preference statements from user text. */
export function extractExplicitPreferences(text: string): TasteEvent[] {
  const events: TasteEvent[] = []
  for (const [re, category, key] of EXPLICIT_PATTERNS) {
    const m = text.match(re)
    if (!m) continue
    const value = m[1] ?? m[0]
    events.push({
      ts: Date.now(),
      sessionID: "",
      type: "explicit",
      raw: m[0],
      confidence: 1.0,
      context: `${category}:${key}=${value}`,
    })
  }
  return events
}

/** Detect correction / rejection signals in user text. */
export function isCorrection(text: string): boolean {
  return CORRECTION_PATTERNS.some((re) => re.test(text.trim()))
}

// ─── Communication style stats ─────────────────────────────────────────────

export function commStyleEvent(text: string): TasteEvent | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const words = trimmed.split(/\s+/).length
  const hasEmoji = /[\p{Extended_Pictographic}]/u.test(trimmed)
  const hasCode = /```|`[a-z]+`|function |const |import /.test(trimmed)
  const isShort = words <= 12
  if (hasEmoji || isShort || hasCode) {
    const style = [
      hasEmoji ? "emoji" : null,
      isShort ? "concise" : "verbose",
      hasCode ? "technical" : null,
    ].filter(Boolean).join(";")
    return {
      ts: Date.now(),
      sessionID: "",
      type: "comm-style",
      raw: style,
      confidence: isShort ? 0.6 : 0.4,
      context: `words=${words}`,
    }
  }
  return null
}

// ─── Consolidation: events → dense preference profile ──────────────────────

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

const EVIDENCE_THRESHOLD = 1.5 // below this, drop the preference
const PROFILE_CAP = 20 // max preferences kept

/**
 * Consolidate raw events into a dense preference profile.
 * Heuristic-based (no LLM call): patterns extracted at capture time carry
 * category/key/value; here we just accumulate evidence, resolve conflicts
 * (newer supersedes older), and cap by evidence. Run at session end or
 * lazily before injection.
 */
export function consolidateTaste(): TasteProfile {
  const events = readLines(TASTE_EVENTS, 5000)
    .map((l) => { try { return JSON.parse(l) as TasteEvent } catch { return null } })
    .filter((e): e is TasteEvent => !!e)
    .map((e) => {
      // Events captured before consolidation (e.g. tool-use with context set)
      // already carry context; comm-style events without context get one here.
      if (e.context) return e
      if (e.type === "tool-use") return { ...e, context: `tools:used=${e.raw}` }
      if (e.type === "correction") return { ...e, context: "quality:correction=user-rejected-output" }
      return e
    })
  const profile = readTasteProfile()
  const prefs = new Map<string, TastePreference>()

  for (const p of profile?.global ?? []) {
    prefs.set(p.id, { ...p })
  }

  const now = Date.now()
  for (const e of events) {
    const [category, keyValue] = (e.context ?? "").split(":", 2)
    if (!category || !keyValue) continue
    const eq = keyValue.indexOf("=")
    if (eq < 0) continue
    const key = keyValue.slice(0, eq)
    const value = keyValue.slice(eq + 1)
    const id = hash(category + ":" + key)

    const existing = prefs.get(id)
    if (existing) {
      // Conflict: same key, different value → newer supersedes.
      if (existing.value !== value) {
        if (e.ts > existing.lastSeen) {
          existing.supersededBy = hash(category + ":" + key + "=" + value)
          const replacement: TastePreference = {
            id: existing.supersededBy,
            category: category as TasteCategory,
            key,
            value,
            evidence: e.confidence,
            firstSeen: e.ts,
            lastSeen: e.ts,
            supersededBy: undefined,
          }
          prefs.set(replacement.id, replacement)
        }
      } else {
        existing.evidence += e.confidence
        existing.lastSeen = Math.max(existing.lastSeen, e.ts)
      }
    } else {
      prefs.set(id, {
        id,
        category: category as TasteCategory,
        key,
        value,
        evidence: e.confidence,
        firstSeen: e.ts,
        lastSeen: e.ts,
      })
    }
  }

  // Decay old evidence (half-life ~30 days), drop weak prefs.
  const decayed = [...prefs.values()].map((p) => {
    const ageDays = (now - p.lastSeen) / (24 * 60 * 60 * 1000)
    p.evidence *= Math.pow(0.5, ageDays / 30)
    return p
  })

  const alive = decayed
    .filter((p) => p.evidence >= EVIDENCE_THRESHOLD && !p.supersededBy)
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, PROFILE_CAP)

  const result: TasteProfile = {
    version: 1,
    updated: now,
    global: alive,
  }
  ensureDir()
  try { writeFileSync(TASTE_PROFILE, JSON.stringify(result, null, 2)) } catch { }
  return result
}

// ─── Injection: profile → compact system-prompt block ──────────────────────

const CATEGORY_LABEL: Record<TasteCategory, string> = {
  communication: "Communication",
  "code-style": "Code style",
  tools: "Tools",
  quality: "Quality bars",
  workflow: "Workflow",
}

function preferenceLine(p: TastePreference): string {
  const rule = p.enforced ? " [enforced]" : ""
  return `- ${p.key}: ${p.value}${rule}`
}

/**
 * Emit the dense <taste-profile> block injected into the system prompt.
 * Budget: ≤ ~500 tokens. Excludes anything already implied by the
 * <codebase-profile> to avoid the redundancy penalty (ETH AGENTS.md study).
 */
const CONSOLIDATION_INTERVAL_MS = 10 * 60 * 1000

function consolidateIfStale(): TasteProfile | null {
  const profile = readTasteProfile()
  const now = Date.now()
  if (!profile || now - profile.updated > CONSOLIDATION_INTERVAL_MS) {
    try { return consolidateTaste() } catch { return profile }
  }
  return profile
}

export function summarizeTaste(): string {
  const profile = consolidateIfStale()
  const codebase = readProfile()
  const parts: string[] = []

  if (codebase && codebase.languages.length > 0) {
    parts.push(
      `<codebase-profile>\n` +
      `Languages: ${codebase.languages.join(", ")}\n` +
      `Stack: ${codebase.technologies.join(", ")}\n` +
      `Build: ${codebase.packageManagers.join(", ")}\n` +
      `Tests: ${codebase.testFrameworks.join(", ")}\n` +
      `</codebase-profile>`,
    )
  }

  if (profile && profile.global.length > 0) {
    // Drop preferences redundant with the codebase profile.
    const redundant = new Set([...(codebase?.languages ?? []), ...(codebase?.technologies ?? [])])
    const prefs = profile.global.filter((p) => !redundant.has(p.value.toLowerCase()))

    const byCategory = new Map<TasteCategory, TastePreference[]>()
    for (const p of prefs) {
      const list = byCategory.get(p.category) ?? []
      list.push(p)
      byCategory.set(p.category, list)
    }

    const lines: string[] = []
    for (const [cat, list] of byCategory) {
      lines.push(`## ${CATEGORY_LABEL[cat] ?? cat}`)
      for (const p of list.slice(0, 5)) lines.push(preferenceLine(p))
    }
    if (lines.length > 0) {
      parts.push(`<taste-profile>\n${lines.join("\n")}\n</taste-profile>`)
    }
  }

  return parts.join("\n")
}

// ─── Codebase profile detection (unchanged) ─────────────────────────────────

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
  try { writeFileSync(PROFILE_FILE, JSON.stringify(profile)) } catch { }
  return profile
}

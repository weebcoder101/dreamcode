import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, statSync } from "fs"
import { join, basename, dirname } from "path"
import { Global } from "@opencode-ai/core/global"
import { homedir } from "os"

// ─── Legacy paths (sensor-gate spawn log — never injected) ──────────────────
const oldEvolutionDir = join(homedir(), ".dreamcode", "evolution")
const EVOLUTION_DIR = existsSync(oldEvolutionDir) ? oldEvolutionDir : join(Global.Path.data, "evolution")
const TASTE_LOG = join(EVOLUTION_DIR, "taste.jsonl")
const OLD_TASTE_EVENTS = join(EVOLUTION_DIR, "taste-events.jsonl")
const PROFILE_FILE = join(EVOLUTION_DIR, "profile.json")

// ─── Command-Code-style taste: per-project transparent markdown ─────────────
// Taste lives in a per-project directory: <data>/taste/<project-key>/.
//   taste.md     — the transparent, human-editable markdown profile
//   events.jsonl — raw episodic events (prompts, edits, corrections, tool use)
// The markdown is the artifact; events are only the raw material.

const TASTE_ROOT = join(Global.Path.data, "taste")

// ─── Legacy signal (sensor-gate spawn decisions — kept for compat, inert) ──

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

// ─── Episodic taste events (the raw signal) ─────────────────────────────────

export type TasteEventType =
  | "explicit"    // "I prefer X", "always use Y" — highest confidence
  | "correction"  // "no, do X instead", user rejecting agent output
  | "tool-use"    // which tools the user's session actually invokes
  | "edit"        // file the agent edited (path observed post-edit)
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

// ─── Per-project layout ─────────────────────────────────────────────────────

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

function projectKey(root: string): string {
  const name = basename(root).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "project"
  return `${name}__${hash(root).slice(0, 10)}`
}

function tasteDir(root: string): string {
  return join(TASTE_ROOT, projectKey(root))
}

function projectEventsPath(root: string): string {
  return join(tasteDir(root), "events.jsonl")
}

function projectTasteMdPath(root: string): string {
  return join(tasteDir(root), "taste.md")
}

function currentProjectRoot(): string {
  try { return process.cwd() } catch { return "" }
}

const MANUAL_START = "<!-- manual:start -->"
const MANUAL_END = "<!-- manual:end -->"

function ensureDir(dir: string) {
  try { mkdirSync(dir, { recursive: true }) } catch { }
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

function appendLine(path: string, line: string) {
  ensureDir(dirname(path))
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

// ─── Signal capture ─────────────────────────────────────────────────────────

/** Record a legacy sensor-gate signal (inert — never injected). */
export function recordTaste(signal: TasteSignal) {
  appendLine(TASTE_LOG, JSON.stringify(signal))
}

/**
 * Record an episodic taste event for the current project. Cheap (single
 * append), safe to call anywhere. Not gated on the sensor gate.
 */
export function recordTasteEvent(event: TasteEvent) {
  appendLine(projectEventsPath(currentProjectRoot()), JSON.stringify(event))
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

/** Communication style stats. */
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

// ─── Events → markdown sections ─────────────────────────────────────────────

const EVIDENCE_THRESHOLD = 1.0 // explicit (1.0) counts once; tool-use (0.5) needs 2 uses

interface SectionPref {
  key: string
  value: string
  evidence: number
}

function accumulate(events: TasteEvent[]): Map<string, SectionPref> {
  const acc = new Map<string, SectionPref>()
  for (const e of events) {
    const ctx = e.context ?? ""
    const [category, keyValue] = ctx.split(":", 2)
    if (!category || !keyValue) continue
    const eq = keyValue.indexOf("=")
    if (eq < 0) continue
    const key = keyValue.slice(0, eq)
    const value = keyValue.slice(eq + 1)
    const id = hash(category + ":" + key)
    const existing = acc.get(id)
    if (existing) {
      existing.evidence += e.confidence
      existing.value = value // newest wins on conflict
    } else {
      acc.set(id, { key, value, evidence: e.confidence })
    }
  }
  return acc
}

function fmtSection(title: string, prefs: SectionPref[], cap = 6): string {
  if (prefs.length === 0) return ""
  const alive = prefs
    .filter((p) => p.evidence >= EVIDENCE_THRESHOLD)
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, cap)
  if (alive.length === 0) return ""
  return `## ${title}\n${alive.map((p) => `- ${p.key}: ${p.value}`).join("\n")}\n`
}

// ─── Folder structure (top-level dirs, 2 levels) ───────────────────────────

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".cache", "target", "build", ".next", ".turbo", "__pycache__", ".venv", "venv", ".pytest_cache"])

function detectFolders(root: string): string[] {
  const dirs: string[] = []
  let entries: string[]
  try { entries = readdirSync(root) } catch { return [] }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e)) continue
    const full = join(root, e)
    let stat: any
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) dirs.push(`${e}/`)
  }
  return dirs.sort().slice(0, 15)
}

// ─── Codebase profile detection ─────────────────────────────────────────────

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
  ensureDir(EVOLUTION_DIR)
  try { writeFileSync(PROFILE_FILE, JSON.stringify(profile)) } catch { }
  return profile
}

// ─── Consolidation: events → taste.md ───────────────────────────────────────

/** Migrate legacy global events into the project file on first consolidation. */
function migrateLegacyEvents(eventsPath: string) {
  try {
    if (existsSync(eventsPath)) return // already has events
    const legacy = readLines(OLD_TASTE_EVENTS, 5000)
    if (legacy.length === 0) return
    ensureDir(dirname(eventsPath))
    writeFileSync(eventsPath, legacy.join("\n") + "\n")
  } catch { }
}

/** Preserve manual edits between markers. */
function extractManualBlock(existing: string | null): string {
  if (!existing) return ""
  const start = existing.indexOf(MANUAL_START)
  if (start < 0) return ""
  const body = existing.slice(start + MANUAL_START.length)
  const end = body.indexOf(MANUAL_END)
  return end >= 0 ? body.slice(0, end).trim() : body.trim()
}

function buildTasteMarkdown(root: string, events: TasteEvent[]): string {
  const name = basename(root) || "project"
  const profile = detectCodebase(root)
  const folders = detectFolders(root)
  const acc = accumulate(events)

  const sections: string[] = []
  sections.push(`# Project Taste — ${name}`)
  sections.push("")
  sections.push("> Auto-learned by the harness from your prompts, edits, and project structure.")
  sections.push("> Edit freely — content between the `manual` markers below is preserved on regeneration.")
  sections.push("")

  // Tech stack
  const stack: string[] = []
  if (profile.languages.length > 0) stack.push(`- Languages: ${profile.languages.join(", ")}`)
  if (profile.packageManagers.length > 0) stack.push(`- Package managers: ${profile.packageManagers.join(", ")}`)
  if (profile.technologies.length > 0) stack.push(`- Stack: ${profile.technologies.join(", ")}`)
  if (profile.testFrameworks.length > 0) stack.push(`- Tests: ${profile.testFrameworks.join(", ")}`)
  if (stack.length > 0) {
    sections.push(`## Tech Stack\n${stack.join("\n")}\n`)
  }

  // Folder structure
  if (folders.length > 0) {
    sections.push(`## Folder Structure\n${folders.map((f) => `- ${f}`).join("\n")}\n`)
  }

  // Code style (from explicit patterns: typing, naming, indentation, always)
  const styleKeys = ["typing", "naming", "indentation", "always"]
  const stylePrefs = styleKeys
    .map((k) => acc.get(hash("code-style:" + k)))
    .filter((p): p is SectionPref => !!p)
  sections.push(fmtSection("Coding Style", stylePrefs))

  // Preferences (tools + quality positives)
  const prefKeys = ["preferred-tool", "tests"]
  const prefPrefs = prefKeys
    .map((k) => acc.get(hash(k === "preferred-tool" ? "tools:preferred-tool" : "quality:tests")))
    .filter((p): p is SectionPref => !!p)
  sections.push(fmtSection("Preferences", prefPrefs))

  // Anti-preferences (never / avoid / corrections)
  const antiPrefs = [...acc.values()].filter(
    (p) => p.key === "never" || p.key === "avoid" || p.key === "correction",
  )
  sections.push(fmtSection("Anti-Preferences", antiPrefs))

  // Communication
  const commPrefs = [...acc.values()].filter(
    (p) => p.key === "verbosity" || p.key === "emoji" || p.key === "reasoning",
  )
  sections.push(fmtSection("Communication", commPrefs))

  // Most-used tools
  const toolCounts = new Map<string, number>()
  for (const e of events) {
    if (e.type === "tool-use" && e.raw) {
      toolCounts.set(e.raw, (toolCounts.get(e.raw) ?? 0) + e.confidence)
    }
  }
  const topTools = [...toolCounts.entries()]
    .filter(([, c]) => c >= EVIDENCE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  if (topTools.length > 0) {
    sections.push(`## Tools\n${topTools.map(([t]) => `- ${t}`).join("\n")}\n`)
  }

  sections.push(MANUAL_START)
  sections.push("")
  sections.push(MANUAL_END)
  return sections.join("\n")
}

/**
 * Consolidate events into the per-project taste.md. The markdown file is the
 * artifact; manual edits between the markers survive regeneration.
 * Returns the previous TasteProfile shape for backward compatibility.
 */
export function consolidateTaste(): TasteProfile {
  const root = currentProjectRoot()
  const eventsPath = projectEventsPath(root)
  migrateLegacyEvents(eventsPath)
  const events = readLines(eventsPath, 5000)
    .map((l) => { try { return JSON.parse(l) as TasteEvent } catch { return null } })
    .filter((e): e is TasteEvent => !!e)
  const mdPath = projectTasteMdPath(root)
  const existing = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null
  const manual = extractManualBlock(existing)
  const md = buildTasteMarkdown(root, events)
  const finalMd = manual
    ? md.replace(MANUAL_START + "\n\n" + MANUAL_END, MANUAL_START + "\n" + manual + "\n" + MANUAL_END)
    : md
  ensureDir(dirname(mdPath))
  try { writeFileSync(mdPath, finalMd) } catch { }

  return { version: 2, updated: Date.now(), global: [] }
}

function tasteMdFresh(root: string): boolean {
  const md = projectTasteMdPath(root)
  const events = projectEventsPath(root)
  if (!existsSync(md)) return false
  try {
    return statSync(events).mtimeMs <= statSync(md).mtimeMs
  } catch {
    return true
  }
}

const TASTE_MD_BUDGET = 1800

/** Read the taste.md for injection (consolidate first if events are newer). */
function readTasteMd(root: string): string {
  if (!tasteMdFresh(root)) {
    try { consolidateTaste() } catch { }
  }
  try {
    const mdPath = projectTasteMdPath(root)
    if (!existsSync(mdPath)) return ""
    let md = readFileSync(mdPath, "utf-8")
    if (md.length > TASTE_MD_BUDGET) {
      md = md.slice(0, TASTE_MD_BUDGET) + "\n... (truncated)\n"
    }
    return md
  } catch {
    return ""
  }
}

/**
 * Emit the <taste-profile> block injected into the system prompt — the
 * per-project taste.md, model-agnostic, NOT gated on the sensor gate.
 */
export function summarizeTaste(): string {
  const root = currentProjectRoot()
  const md = readTasteMd(root)
  if (!md.trim()) return ""
  return `<taste-profile>\n${md.trim()}\n</taste-profile>`
}

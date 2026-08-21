import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, unlinkSync } from "fs"
import { join, basename, dirname } from "path"
import { Global } from "@opencode-ai/core/global"
import { homedir } from "os"

// ─── Legacy paths (sensor-gate spawn log — never injected) ──────────────────
const oldEvolutionDir = join(homedir(), ".dreamcode", "evolution")
const EVOLUTION_DIR = existsSync(oldEvolutionDir) ? oldEvolutionDir : join(Global.Path.data, "evolution")
const TASTE_LOG = join(EVOLUTION_DIR, "taste.jsonl")
const OLD_TASTE_EVENTS = join(EVOLUTION_DIR, "taste-events.jsonl")
const PROFILE_FILE = join(EVOLUTION_DIR, "profile.json")

// ─── Command-Code-style taste: transparent markdown in the project ─────────
// The artifact (taste.md) lives IN the project at .dreamcode/taste.md —
// visible, shareable, human-editable like Command Code's taste file. Raw
// episodic events stay in <data>/taste/<project-key>/events.jsonl (prompts,
// edits, corrections, tool use). The markdown is the artifact; events are
// only the raw material.

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

// ─── Decay engine (research: w = w0·0.5^(age/H)) ───────────────────────────
// Preferences that aren't re-confirmed fade; real ones become nearly
// permanent. Category half-lives from the consolidation research:
//   stable (explicit, correction) 90d · tooling (tool-use, edit, code-style,
//   quality) 30d · transient (comm-style, workflow) 1-2d.
// A value that was later contradicted (a key whose latest value changed)
// decays 10× faster, so stale preferences fade and contradictions resolve.

const DAY_MS = 24 * 60 * 60 * 1000
const HALF_LIFE_MS: Record<TasteEventType, number> = {
  explicit: 90 * DAY_MS,
  correction: 90 * DAY_MS,
  "tool-use": 30 * DAY_MS,
  edit: 30 * DAY_MS,
  "comm-style": 2 * DAY_MS,
  workflow: 2 * DAY_MS,
}
const CONTRADICTION_HALF_LIFE_MS = 1 * DAY_MS

function decayWeight(e: TasteEvent, now: number, fastDecay: boolean): number {
  const H = fastDecay ? CONTRADICTION_HALF_LIFE_MS : HALF_LIFE_MS[e.type] ?? 30 * DAY_MS
  const age = Math.max(0, now - e.ts)
  return e.confidence * Math.pow(0.5, age / H)
}

export type TasteCategory = "communication" | "code-style" | "tools" | "quality" | "workflow" | "cost" | "model"

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

export const hash = (s: string) => {
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
  return join(root, ".dreamcode", "taste.md")
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
  // Tools & code style
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
  [/keep (?:it|things) (short|concise|brief|simple)/i, "communication", "verbosity"],
  // Cost consciousness — what cmdc captures well and we missed
  [/(?:keep|stay|be) (?:cost|budget|spend|token) (?:low|minimal|down|conscious|aware)/i, "cost", "cost-conscious"],
  [/cost[- ]?(?:aware|conscious|sensitive|minded)/i, "cost", "cost-conscious"],
  [/don'?t (?:use|waste|burn|spend) (?:expensive|premium| costly) (?:models?|tokens?|api)/i, "cost", "cost-conscious"],
  [/prefer (?:cheap|free|budget|low[- ]cost) (?:models?|providers?)/i, "cost", "cost-conscious"],
  [/(?:max|cap|limit) (?:tokens?|cost|spend|budget) (?:at|to|per) /i, "cost", "budget-limit"],
  [/token[- ]?(?:budget|limit|cap)/i, "cost", "cost-conscious"],
  // Workflow preferences
  [/(?:complete|finish|verify) (?:all|everything) (?:then|before) (?:build|compile|rebuild)/i, "workflow", "complete-then-build"],
  [/never (?:run|execute) bare (?:bun|npm|yarn|pnpm) (?:run )?build/i, "workflow", "no-bare-build"],
  [/(?:always|must) (?:rebuild|build) (?:with|-- )?--single/i, "workflow", "use-single-flag"],
  [/(?:test|verify|check) before (?:commit|push|merge)/i, "workflow", "test-first"],
  // Model selection preferences
  [/(?:prefer|use|default to) (hy3|deepseek|claude|gpt|gemini)/i, "model", "preferred-model"],
  [/(?:don'?t|never|avoid) (?:use|spawning) (deepseek|claude|gpt|gemini)/i, "model", "avoid-model"],
  [/free models? (?:only|preferred|always)/i, "model", "free-models-only"],
]

const CORRECTION_PATTERNS: RegExp[] = [
  /^(no|nope|not that|wrong|that'?s not|stop|don'?t do that|undo|revert|actually)/i,
  /^instead (?:do|use|try|make it)/i,
  /^(please )?(?:redo|redo it|try again|different)/i,
  /\b(don'?t|never|stop) (?:use|do|write|add) (that|this|it|the)/i,
]

const STOPWORDS = new Set([
  "but", "and", "the", "to", "for", "a", "an", "that", "it", "this", "my",
  "our", "your", "with", "of", "in", "on", "at", "by", "from", "so", "then",
  "just", "really", "much", "more", "less", "not", "no", "yes", "please",
])

/** Filter junk captured values: filler words, single chars, empty strings. */
function cleanValue(v: string): string | null {
  const t = v.trim()
  if (t.length < 2) return null
  if (STOPWORDS.has(t.toLowerCase())) return null
  return t
}

/** Extract explicit preference statements from user text. */
export function extractExplicitPreferences(text: string): TasteEvent[] {
  const events: TasteEvent[] = []
  for (const [re, category, key] of EXPLICIT_PATTERNS) {
    const m = text.match(re)
    if (!m) continue
    const value = cleanValue(m[1] ?? m[0])
    if (!value) continue
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

// Emit floor (research 3: cumulative weight ≥ 0.6). Decay means even a fresh
// 1.0-confidence event weighs 0.99997… (age > 0), so a threshold of 1.0 would
// silently kill every single strong signal. 0.6: one fresh explicit/correction
// emits; a 90-day-old single signal (~0.5) fades; two tool-uses (0.5 each) emit.
const EVIDENCE_THRESHOLD = 0.6

interface SectionPref {
  key: string
  value: string
  evidence: number
  lastSeen: number
}

function parseCtx(ctx: string | undefined): { id: string; key: string; value: string } | null {
  if (!ctx) return null
  const [category, keyValue] = ctx.split(":", 2)
  if (!category || !keyValue) return null
  const eq = keyValue.indexOf("=")
  if (eq < 0) return null
  const key = keyValue.slice(0, eq)
  const value = keyValue.slice(eq + 1)
  return { id: hash(category + ":" + key), key, value }
}

export function accumulate(events: TasteEvent[]): Map<string, SectionPref> {
  const now = Date.now()
  // Pass 1: latest value per preference id (to detect contradictions).
  const latest = new Map<string, { value: string; ts: number }>()
  for (const e of events) {
    const kv = parseCtx(e.context)
    if (!kv) continue
    const l = latest.get(kv.id)
    if (!l || e.ts > l.ts) latest.set(kv.id, { value: kv.value, ts: e.ts })
  }
  // Pass 2: decayed evidence; superseded values decay 10× faster.
  const acc = new Map<string, SectionPref>()
  for (const e of events) {
    const kv = parseCtx(e.context)
    if (!kv) continue
    const isCurrent = latest.get(kv.id)?.value === kv.value
    const w = decayWeight(e, now, !isCurrent)
    const existing = acc.get(kv.id)
    if (existing) {
      existing.evidence += w
      if (e.ts > existing.lastSeen) {
        existing.lastSeen = e.ts
        existing.value = kv.value
      }
    } else {
      acc.set(kv.id, { key: kv.key, value: kv.value, evidence: w, lastSeen: e.ts })
    }
  }
  return acc
}

// Normalize identifier/tool values so near-duplicates ("pnpm" vs "pnpm")
// collapse to one entry (utility-aware shrinkage — SkillProx/SkillEvo).
function normVal(v: string): string {
  return v.trim().toLowerCase().replace(/[._-]+/g, "")
}

function fmtSection(title: string, prefs: SectionPref[], cap = 6): string {
  if (prefs.length === 0) return ""
  // Near-duplicate merge by (key, normalized value); keep stronger evidence.
  const merged = new Map<string, SectionPref>()
  for (const p of prefs) {
    const k = p.key + "::" + normVal(p.value)
    const ex = merged.get(k)
    if (!ex || p.evidence > ex.evidence) merged.set(k, p)
  }
  const alive = [...merged.values()]
    .filter((p) => p.evidence >= EVIDENCE_THRESHOLD)
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, cap) // lowest-weight eviction when over cap
  if (alive.length === 0) return ""
  // Cap evidence at 1.0 for display; round to 2 decimals for readability
  const fmt = (p: SectionPref) => {
    const conf = Math.min(1, p.evidence)
    return `- ${p.key}: ${p.value} (confidence: ${conf.toFixed(2)})`
  }
  return `## ${title}\n${alive.map(fmt).join("\n")}\n`
}

// Exported for unit tests (section-emission regression: fresh strong signals
// must survive the decay + threshold gate).
export { fmtSection }

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

  // Folders observed via edit/write events — Command Code learns structure
  // from where the agent actually writes (e.g. a /commands directory).
  for (const e of events) {
    if (e.type !== "edit") continue
    const rel = e.raw.startsWith(root) ? e.raw.slice(root.length).replace(/^[/\\]+/, "") : e.raw
    const first = rel.split(/[/\\]/)[0]
    if (first && !folders.includes(first + "/")) folders.push(first + "/")
  }
  folders.sort()

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

  // Anti-preferences (never / avoid / corrections) — hard do-not-do rules
  // get primacy (research: top of file = highest adherence).
  const antiPrefs = [...acc.values()].filter(
    (p) => p.key === "never" || p.key === "avoid" || p.key === "correction",
  )
  sections.push(fmtSection("Anti-Preferences", antiPrefs))

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

  // Communication
  const commPrefs = [...acc.values()].filter(
    (p) => p.key === "verbosity" || p.key === "emoji" || p.key === "reasoning",
  )
  sections.push(fmtSection("Communication", commPrefs))

  // Cost consciousness — behavioral, not descriptive (what cmdc captures well)
  const costPrefs = [...acc.values()].filter(
    (p) => p.key === "cost-conscious" || p.key === "budget-limit",
  )
  sections.push(fmtSection("Cost Consciousness", costPrefs, 4))

  // Workflow preferences — behavioral process rules
  const workflowPrefs = [...acc.values()].filter(
    (p) => p.key === "complete-then-build" || p.key === "no-bare-build" || p.key === "use-single-flag" || p.key === "test-first",
  )
  sections.push(fmtSection("Workflow", workflowPrefs, 4))

  // Model selection preferences
  const modelPrefs = [...acc.values()].filter(
    (p) => p.key === "preferred-model" || p.key === "avoid-model" || p.key === "free-models-only",
  )
  sections.push(fmtSection("Model Preferences", modelPrefs, 3))

  // Implicit preferences (§2.1): inferred from edit patterns
  const implicitPrefs = inferImplicitPreferences(events)
  if (implicitPrefs.length > 0) {
    const lines = implicitPrefs.map((p) =>
      `- ${p.key}: ${p.value} (confidence: ${p.confidence.toFixed(2)}) — ${p.evidence}`,
    )
    sections.push(`## Inferred Preferences\n${lines.join("\n")}\n`)
  }

  // Cross-project preferences (§2.2): from other projects with strong evidence
  const crossProject = getCrossProjectPreferences(name)
  if (crossProject.length > 0) {
    const lines = crossProject.slice(0, 5).map((p) =>
      `- ${p.key}: ${p.value} (from ${p.sourceProject}, confidence: ${p.confidence.toFixed(2)})`,
    )
    sections.push(`## Cross-Project Insights\n${lines.join("\n")}\n`)
  }

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
  // Rotation: once the log passes 5000 events, fold the tail (dropped events
  // are ≥6 half-lives old — their decayed weight is negligible) and keep the
  // last 3000 lines so the log never grows unbounded.
  const all = readLines(eventsPath, Number.MAX_SAFE_INTEGER)
  if (all.length > 5000) {
    try { writeFileSync(eventsPath, all.slice(-3000).join("\n") + "\n") } catch { }
  }
  const events = all
    .map((l) => { try { return JSON.parse(l) as TasteEvent } catch { return null } })
    .filter((e): e is TasteEvent => !!e)
  const mdPath = projectTasteMdPath(root)
  const existing = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null
  const manual = extractManualBlock(existing)
  const md = buildTasteMarkdown(root, events)
  const finalMd = manual
    ? md.slice(0, md.indexOf(MANUAL_START)) + MANUAL_START + "\n" + manual + "\n" + MANUAL_END + "\n"
    : md
  // Cross-project memory (§2.2): contribute strong preferences to shared pool
  contributeToSharedMemory(root, events)

  // Clone-then-rewrite safety primitive (Claude Dreams): never mutate the
  // input events; write to a temp file, swap atomically, keep a .bak.
  const tmp = mdPath + ".tmp"
  try {
    ensureDir(dirname(mdPath))
    writeFileSync(tmp, finalMd)
    if (existsSync(mdPath)) {
      try { renameSync(mdPath, mdPath + ".bak") } catch { }
    }
    renameSync(tmp, mdPath)
  } catch {
    try { unlinkSync(tmp) } catch { }
    const alt = join(TASTE_ROOT, projectKey(root), "taste.md")
    ensureDir(dirname(alt))
    try { writeFileSync(alt, finalMd) } catch { }
  }

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

// Soft 2k / hard 3k TOKENS (research): evict by low-weight, then trim at a
// line boundary so sections are never cut mid-line. Token estimate = chars/4.
const TASTE_MD_SOFT = 2000
const TASTE_MD_HARD = 3000
const TOKENS_PER_CHAR = 4

function estTokens(md: string): number {
  return Math.ceil(md.length / TOKENS_PER_CHAR)
}

/** Trim at the last line boundary ≤ limit tokens so no section is cut mid-line. */
export function fitBudget(md: string, limit: number): string {
  if (estTokens(md) <= limit) return md
  const charLimit = limit * TOKENS_PER_CHAR
  const cut = md.lastIndexOf("\n", charLimit)
  const at = cut > 0 ? cut : charLimit
  return md.slice(0, at) + "\n... (trimmed to fit budget)\n"
}

// Debounce consolidation so the prompt hot path never blocks on a full
// consolidate (recursive FS walk + event replay). At most one per window.
let lastConsolidateAt = 0
const CONSOLIDATE_DEBOUNCE_MS = 5 * 60 * 1000


let _tasteMdCache: { path: string; mtime: number; size: number; content: string } | undefined
/** Read the taste.md for injection (consolidate if events are newer, debounced). */
function readTasteMd(root: string): string {
  const now = Date.now()
  if (!tasteMdFresh(root) && now - lastConsolidateAt > CONSOLIDATE_DEBOUNCE_MS) {
    lastConsolidateAt = now
    try { consolidateTaste() } catch (e) { console.warn("taste consolidation failed", e) }
  }
  const mdPath = projectTasteMdPath(root)
  if (!mdPath || !existsSync(mdPath)) return ""
  const st = statSync(mdPath)
  if (_tasteMdCache && _tasteMdCache.path === mdPath && _tasteMdCache.mtime === st.mtimeMs && _tasteMdCache.size === st.size) {
    return _tasteMdCache.content
  }
  try {
    let md = readFileSync(mdPath, "utf-8")
    if (md.length > TASTE_MD_HARD) md = fitBudget(md, TASTE_MD_HARD)
    else if (md.length > TASTE_MD_SOFT) md = fitBudget(md, TASTE_MD_SOFT)
    _tasteMdCache = { path: mdPath, mtime: st.mtimeMs, size: st.size, content: md }
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
  // Behavioral anchoring (§2.6): frame taste as active behavioral instructions
  // placed AFTER the static system prompt (cached) and BEFORE conversation
  // history (active attention window). Research shows behavioral instructions
  // in this position have the highest adherence.
  return [
    `<taste-profile>`,
    `Based on your preferences, I will adapt my behavior accordingly.`,
    ``,
    md.trim(),
    `</taste-profile>`,
  ].join("\n")
}

// ─── Implicit Preference Inference (§2.1) ───────────────────────────────
// Infer preferences from observed edit patterns without requiring the user
// to state them explicitly. Watches temporal patterns in edit events to
// extract behavioral preferences the user has never verbalized.

export interface ImplicitPreference {
  category: TasteCategory
  key: string
  value: string
  confidence: number // 0..1; based on pattern consistency
  evidence: string  // human-readable explanation of the pattern
}

/**
 * Infer implicit preferences from a sequence of edit events.
 * Patterns detected:
 *  1. TDD preference: user consistently creates/edits test files before source
 *  2. Language preference: user's edits concentrate in one language
 *  3. Folder preference: user's edits concentrate in specific directories
 *  4. Sequential editing: user edits related files in sequence (co-change)
 */
export function inferImplicitPreferences(events: TasteEvent[]): ImplicitPreference[] {
  const prefs: ImplicitPreference[] = []
  const editEvents = events.filter((e) => e.type === "edit" && e.raw)
  if (editEvents.length < 3) return prefs // need at least 3 edits to infer patterns

  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const recentEdits = editEvents.filter((e) => now - e.ts < 7 * DAY) // last 7 days
  if (recentEdits.length < 3) return prefs

  // 1. TDD preference: test files edited before source files
  const testFirstPairs = countTestFirstPairs(recentEdits)
  if (testFirstPairs >= 3) {
    prefs.push({
      category: "quality",
      key: "tdd-preference",
      value: "test-first",
      confidence: Math.min(0.9, 0.5 + testFirstPairs * 0.08),
      evidence: `${testFirstPairs} test-before-source edit sequences in last 7 days`,
    })
  }

  // 2. Language preference: which file types dominate
  const langCounts = new Map<string, number>()
  for (const e of recentEdits) {
    const ext = e.raw.split(".").pop()?.toLowerCase()
    if (ext) langCounts.set(ext, (langCounts.get(ext) ?? 0) + 1)
  }
  const total = recentEdits.length
  for (const [ext, count] of langCounts) {
    const ratio = count / total
    if (ratio > 0.6 && count >= 3) {
      const lang = extToLanguage(ext)
      if (lang) {
        prefs.push({
          category: "code-style",
          key: "primary-language",
          value: lang,
          confidence: Math.min(0.85, 0.4 + ratio * 0.5),
          evidence: `${Math.round(ratio * 100)}% of recent edits are .${ext} files`,
        })
      }
    }
  }

  // 3. Folder concentration: edits concentrate in specific directories
  const folderCounts = new Map<string, number>()
  for (const e of recentEdits) {
    const parts = e.raw.replace(/\\/g, "/").split("/")
    if (parts.length >= 2) {
      folderCounts.set(parts[0], (folderCounts.get(parts[0]) ?? 0) + 1)
    }
  }
  for (const [folder, count] of folderCounts) {
    const ratio = count / total
    if (ratio > 0.5 && count >= 3) {
      prefs.push({
        category: "workflow",
        key: "primary-directory",
        value: folder,
        confidence: Math.min(0.8, 0.3 + ratio * 0.5),
        evidence: `${Math.round(ratio * 100)}% of recent edits in ${folder}/`,
      })
    }
  }

  return prefs
}

/** Count how many times a test file was edited before its corresponding source. */
function countTestFirstPairs(edits: TasteEvent[]): number {
  let count = 0
  // Group edits by timestamp proximity (within 2 min = same "session")
  const sessions: TasteEvent[][] = []
  let current: TasteEvent[] = []
  let lastTs = 0
  for (const e of [...edits].sort((a, b) => a.ts - b.ts)) {
    if (e.ts - lastTs > 2 * 60 * 1000) {
      if (current.length > 0) sessions.push(current)
      current = []
    }
    current.push(e)
    lastTs = e.ts
  }
  if (current.length > 0) sessions.push(current)

  for (const session of sessions) {
    const testEdits = session.filter((e) => /\.(test|spec|_test|_spec)\./i.test(e.raw))
    const srcEdits = session.filter((e) => !/\.(test|spec|_test|_spec)\./i.test(e.raw))
    if (testEdits.length > 0 && srcEdits.length > 0) {
      // Was a test file edited before a source file in this session?
      const firstTest = Math.min(...testEdits.map((e) => e.ts))
      const firstSrc = Math.min(...srcEdits.map((e) => e.ts))
      if (firstTest < firstSrc) count++
    }
  }
  return count
}

function extToLanguage(ext: string): string | null {
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript",
    js: "JavaScript", jsx: "JavaScript",
    py: "Python",
    go: "Go",
    rs: "Rust",
    rb: "Ruby",
    java: "Java",
    cpp: "C++", c: "C",
    zig: "Zig",
  }
  return map[ext] ?? null
}

// ─── Cross-Session Semantic Memory (§2.2) ──────────────────────────────
// Share taste insights across different projects. When a user works on
// multiple projects with the same coding style, preferences learned in
// one project should bootstrap the taste profile of another.
//
// Implementation: a shared "global" taste directory that accumulates
// cross-project insights. Each project's consolidation can pull from
// this shared memory and contribute back.

const GLOBAL_TASTE_DIR = join(Global.Path.data, "taste", "_global")
const GLOBAL_PREFS_FILE = join(GLOBAL_TASTE_DIR, "shared-preferences.json")

export interface SharedPreference {
  key: string
  value: string
  category: TasteCategory
  confidence: number
  sourceProject: string
  lastUsed: number
  useCount: number
}

/** Load shared cross-project preferences. */
function loadSharedPreferences(): SharedPreference[] {
  try {
    if (!existsSync(GLOBAL_PREFS_FILE)) return []
    return JSON.parse(readFileSync(GLOBAL_PREFS_FILE, "utf-8")) as SharedPreference[]
  } catch {
    return []
  }
}

/** Save shared cross-project preferences. */
function saveSharedPreferences(prefs: SharedPreference[]): void {
  ensureDir(GLOBAL_TASTE_DIR)
  try {
    writeFileSync(GLOBAL_PREFS_FILE, JSON.stringify(prefs, null, 2))
  } catch {}
}

/**
 * Contribute project-level preferences to the shared global pool.
 * Called during consolidation; only preferences with sufficient evidence
 * are shared to avoid propagating noise.
 */
export function contributeToSharedMemory(projectRoot: string, events: TasteEvent[]): void {
  const acc = accumulate(events)
  const project = basename(projectRoot)
  const shared = loadSharedPreferences()
  const now = Date.now()

  for (const pref of acc.values()) {
    if (pref.evidence < 0.8) continue // only strong signals
    const existing = shared.find((s) => s.key === pref.key && s.value === pref.value)
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.lastUsed = now
      existing.useCount++
    } else {
      shared.push({
        key: pref.key,
        value: pref.value,
        category: hash(pref.key) as any,
        confidence: pref.evidence,
        sourceProject: project,
        lastUsed: now,
        useCount: 1,
      })
    }
  }

  // Evict stale shared preferences (not used in 90 days)
  const evicted = shared.filter((s) => now - s.lastUsed < 90 * 24 * 60 * 60 * 1000)
  saveSharedPreferences(evicted)
}

/**
 * Get cross-project preferences to bootstrap a new project's taste.
 * Returns preferences from OTHER projects that have strong evidence.
 */
export function getCrossProjectPreferences(currentProject: string): SharedPreference[] {
  return loadSharedPreferences().filter(
    (s) => s.sourceProject !== currentProject && s.confidence >= 0.7,
  )
}

// ─── Taste Effectiveness Tracking (§8.2) ─────────────────────────────────
// Measure whether taste preferences actually improve agent behavior.
// ─── Failure-Driven Taste Refinement (§2.4) ─────────────────────────────
// When a correction occurs, the agent's preceding action was wrong.
// Analyze the correction pattern to refine the taste profile:
//   1. If user corrects style → add/strengthen anti-preference
//   2. If user corrects approach → record as workflow correction
//   3. If user corrects tool choice → adjust tool preferences

export interface FailureRefinement {
  /** The type of correction */
  type: "style" | "approach" | "tool" | "content"
  /** The correction text */
  correction: string
  /** Inferred anti-preference to add */
  antiPreference?: { category: TasteCategory; key: string; value: string }
}

/**
 * Analyze a correction event and infer what taste refinement to apply.
 */
export function refineFromFailure(correction: string): FailureRefinement | null {
  const text = correction.toLowerCase().trim()

  // Style correction: user wants different verbosity/format
  if (/be more (concise|brief|short|terse|compact)/i.test(text)) {
    return {
      type: "style",
      correction,
      antiPreference: { category: "communication", key: "verbose-output", value: "avoid" },
    }
  }
  if (/be more (detailed|thorough|verbose|explaining)/i.test(text)) {
    return {
      type: "style",
      correction,
      antiPreference: { category: "communication", key: "terse-output", value: "avoid" },
    }
  }

  // Approach correction: user wants different method
  if (/don'?t (use|do|try|implement) (that|this|it)/i.test(text)) {
    return {
      type: "approach",
      correction,
    }
  }

  // Tool correction: user rejects tool choice
  if (/use (grep|read|bash|edit) (instead|next|to|instead of)/i.test(text)) {
    return {
      type: "tool",
      correction,
    }
  }

  // Content correction: wrong result
  if (/wrong|incorrect|not (right|correct|what)/i.test(text)) {
    return {
      type: "content",
      correction,
    }
  }

  return null
}

// ─── Behavioral Preference Attributes (PrefIx Framework §2.3) ────────────
// Structured behavioral attributes that the agent can adapt to, based on
// the PrefIx framework (2026). These go beyond simple preferences to
// capture HOW the agent should behave in different situations.

export interface BehavioralAttribute {
  /** Attribute name */
  attribute: string
  /** Preferred value */
  value: string
  /** Confidence based on evidence */
  confidence: number
  /** Source of inference */
  source: "explicit" | "inferred" | "cross-project"
}

/**
 * Infer behavioral attributes from accumulated events.
 * PrefIx defines 14 attributes; we implement the 8 most actionable ones.
 */
export function inferBehavioralAttributes(events: TasteEvent[]): BehavioralAttribute[] {
  const attrs: BehavioralAttribute[] = []
  const editEvents = events.filter((e) => e.type === "edit" && e.raw)
  const toolEvents = events.filter((e) => e.type === "tool-use" && e.raw)
  const corrections = events.filter((e) => e.type === "correction")

  // 1. Response Verbosity: from comm-style events and corrections
  const commEvents = events.filter((e) => e.type === "comm-style")
  const shortCount = commEvents.filter((e) => e.raw.includes("concise")).length
  const longCount = commEvents.filter((e) => e.raw.includes("verbose")).length
  if (shortCount > longCount && shortCount >= 2) {
    attrs.push({ attribute: "responseVerbosity", value: "concise", confidence: 0.7, source: "inferred" })
  } else if (longCount > shortCount && longCount >= 2) {
    attrs.push({ attribute: "responseVerbosity", value: "detailed", confidence: 0.7, source: "inferred" })
  }

  // 2. Proactivity: does the agent need to ask or just do?
  if (corrections.length < 2 && editEvents.length > 5) {
    attrs.push({ attribute: "proactivity", value: "high", confidence: 0.6, source: "inferred" })
  } else if (corrections.length > 5) {
    attrs.push({ attribute: "proactivity", value: "ask-first", confidence: 0.7, source: "inferred" })
  }

  // 3. Error Handling: retry vs ask user
  const errorTools = toolEvents.filter((e) => e.raw === "bash")
  if (errorTools.length > 3) {
    attrs.push({ attribute: "errorHandling", value: "retry-autonomously", confidence: 0.5, source: "inferred" })
  }

  // 4. File Organization: edits concentrated vs spread
  const folderSet = new Set(editEvents.map((e) => {
    const parts = e.raw.replace(/\\/g, "/").split("/")
    return parts.length >= 2 ? parts[0] : "root"
  }))
  if (folderSet.size <= 2 && editEvents.length >= 5) {
    attrs.push({ attribute: "fileOrganization", value: "concentrated", confidence: 0.6, source: "inferred" })
  }

  // 5. Testing Preference: from tool usage
  const testTools = toolEvents.filter((e) => /test|vitest|jest|bun test/i.test(e.raw))
  if (testTools.length >= 3) {
    attrs.push({ attribute: "testingPreference", value: "frequent", confidence: 0.7, source: "inferred" })
  }

  return attrs
}

// After each session, track which preferences were applied, how many
// corrections happened, and infer user satisfaction.

export interface TasteEffectiveness {
  /** Session ID */
  sessionID: string
  /** Which taste preferences were referenced in the session */
  preferencesUsed: string[]
  /** Number of corrections received from the user */
  correctionsReceived: number
  /** Inferred satisfaction (1 - correctionRate), clamped 0..1 */
  userSatisfaction: number
  /** Recommendations for improving the taste profile */
  recommendations: string[]
}

/**
 * Measure taste effectiveness for a session by analyzing events.
 */
export function measureEffectiveness(sessionID: string): TasteEffectiveness {
  const root = currentProjectRoot()
  const eventsPath = projectEventsPath(root)
  const all = readLines(eventsPath, Number.MAX_SAFE_INTEGER)
  const events = all
    .map((l) => { try { return JSON.parse(l) as TasteEvent } catch { return null } })
    .filter((e): e is TasteEvent => !!e && e.sessionID === sessionID)

  // Count corrections
  const corrections = events.filter((e) => e.type === "correction").length
  const totalInteractions = events.length
  const correctionRate = totalInteractions > 0 ? corrections / totalInteractions : 0
  const satisfaction = Math.max(0, Math.min(1, 1 - correctionRate * 5)) // 20% corrections = 0 satisfaction

  // Extract which preferences were used
  const preferencesUsed = events
    .filter((e) => e.type === "explicit" || e.type === "tool-use")
    .map((e) => e.context ?? e.raw)
    .filter(Boolean)
  const uniquePrefs = [...new Set(preferencesUsed)].slice(0, 10)

  // Generate recommendations
  const recommendations: string[] = []
  if (corrections > 3) {
    recommendations.push("High correction rate detected — consider adding anti-preferences for corrected patterns")
  }
  const toolEvents = events.filter((e) => e.type === "tool-use")
  if (toolEvents.length > 5) {
    const toolCounts = new Map<string, number>()
    for (const e of toolEvents) {
      toolCounts.set(e.raw, (toolCounts.get(e.raw) ?? 0) + 1)
    }
    const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topTool && topTool[1] > 3) {
      recommendations.push(`Frequently used tool: ${topTool[0]} — consider adding it to preferences`)
    }
  }

  return {
    sessionID,
    preferencesUsed: uniquePrefs,
    correctionsReceived: corrections,
    userSatisfaction: Math.round(satisfaction * 100) / 100,
    recommendations,
  }
}

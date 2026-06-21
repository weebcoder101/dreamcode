import { Effect, Context, Layer, Duration } from "effect"
// Stream and ChildProcess removed — replaced with Bun.spawn (compiled binary fix)
import * as fs from "fs"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"
import { buildPrompt } from "./prompt-engine"

const SAFE_PROMPT_MAX = 100_000
const USER_AGENT_COUNT_RE = /(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i
const RATE_MAX_SPAWNS = 5

export interface Persona {
  name: string
  role: string
  focus: string
  skills: string[]
  task: string
  goals: string[]
  synthesisGuide: string
  tools?: string[]
  neuroResult?: string
}

const PERSONA_SCAN_TYPE_MAP: Record<string, string> = {
  "The Sentinel": "security",
  "The Diplomat": "full_audit",
  "The Cartographer": "full_audit",
  "The Artisan": "full_audit",
  "The Optimizer": "bug_hunt",
  "The Examiner": "test_gap",
  "The Architect": "full_audit",
  "The Sculptor": "full_audit",
  "The Detective": "bug_hunt",
  "The Navigator": "full_audit",
  "The Chronicler": "full_audit",
  "The Analyst": "full_audit",
  "The Strategist": "full_audit",
  "The Integrator": "full_audit",
}

interface PersonaProfile {
  name: string
  role: string
  focus: string
  skills: string[]
  tags: string[]
  minComplexity: number
}

const PERSONA_PROFILES: PersonaProfile[] = [
  {
    name: "The Architect",
    role: "System Design Specialist",
    focus: "Architecture, data flow, system boundaries, and design patterns",
    skills: ["architecture", "design", "system-thinking"],
    tags: ["architecture", "design", "system", "planning", "refactoring"],
    minComplexity: 1,
  },
  {
    name: "The Artisan",
    role: "Code Quality Specialist",
    focus: "Implementation, code style, best practices, and idiomatic patterns",
    skills: ["code-quality", "best-practices", "implementation"],
    tags: ["implementation", "code", "quality", "refactoring", "python", "react", "frontend"],
    minComplexity: 1,
  },
  {
    name: "The Sentinel",
    role: "Security & Edge Case Specialist",
    focus: "Vulnerabilities, error handling, input validation, and safety",
    skills: ["security", "edge-cases", "defensive-programming"],
    tags: ["security", "safety", "edge-cases", "error-handling", "audit"],
    minComplexity: 2,
  },
  {
    name: "The Detective",
    role: "Root Cause Analysis Specialist",
    focus: "Bug causation, reproduction steps, and fault isolation",
    skills: ["debugging", "root-cause", "investigation"],
    tags: ["debugging", "fix", "bug", "error", "crash", "broken"],
    minComplexity: 1,
  },
  {
    name: "The Optimizer",
    role: "Performance & Efficiency Specialist",
    focus: "Benchmarking, latency, memory, and computational efficiency",
    skills: ["performance", "optimization", "profiling"],
    tags: ["performance", "optimize", "speed", "latency", "slow"],
    minComplexity: 2,
  },
  {
    name: "The Navigator",
    role: "Project Structure Specialist",
    focus: "Dependency graph, module boundaries, build system, and file layout",
    skills: ["project-structure", "dependencies", "build"],
    tags: ["planning", "architecture", "structure", "build", "devops"],
    minComplexity: 2,
  },
  {
    name: "The Analyst",
    role: "Code Review & Standards Specialist",
    focus: "Standards compliance, diff analysis, and regression detection",
    skills: ["review", "standards", "compliance"],
    tags: ["review", "audit", "examine", "inspect", "refactoring", "verification"],
    minComplexity: 1,
  },
  {
    name: "The Examiner",
    role: "Test Coverage Specialist",
    focus: "Test gaps, test quality, edge coverage, and assertion strength",
    skills: ["testing", "coverage", "quality-assurance"],
    tags: ["testing", "test", "coverage", "quality"],
    minComplexity: 2,
  },
  {
    name: "The Cartographer",
    role: "Documentation & API Surface Specialist",
    focus: "API contracts, documentation, type definitions, and public interfaces",
    skills: ["documentation", "api-design", "interfaces"],
    tags: ["documentation", "api", "design", "communication"],
    minComplexity: 2,
  },
  {
    name: "The Chronicler",
    role: "Process & Automation Specialist",
    focus: "CI/CD, workflows, automation pipelines, and tooling",
    skills: ["automation", "devops", "tooling"],
    tags: ["automation", "devops", "ci", "cd", "pipeline", "deploy"],
    minComplexity: 2,
  },
  {
    name: "The Diplomat",
    role: "Product & Requirements Specialist",
    focus: "Stakeholder needs, trade-off analysis, and requirement clarity",
    skills: ["product", "requirements", "communication"],
    tags: ["product", "feature", "user", "requirement", "planning"],
    minComplexity: 2,
  },
  {
    name: "The Sculptor",
    role: "Refactoring & Cleanup Specialist",
    focus: "Dead code elimination, simplification, and technical debt reduction",
    skills: ["refactoring", "cleanup", "simplification"],
    tags: ["refactoring", "cleanup", "restructure", "improve", "enhance"],
    minComplexity: 1,
  },
  {
    name: "The Strategist",
    role: "Innovation & Breakthrough Specialist",
    focus: "Novel approaches, alternative solutions, and creative problem-solving",
    skills: ["innovation", "creativity", "research"],
    tags: ["innovation", "breakthrough", "novel", "research", "explore"],
    minComplexity: 3,
  },
  {
    name: "The Integrator",
    role: "System Integration Specialist",
    focus: "Cross-module integration, data flow between components, and compatibility",
    skills: ["integration", "compatibility", "coordination"],
    tags: ["architecture", "integration", "api", "system"],
    minComplexity: 3,
  },
]

function dynamicTaskFor(persona: { name: string; role: string; focus: string }, intent: string): string {
  const t: Record<string, string> = {
    "The Architect": `Review the architecture, data flow, system boundaries, and design patterns relevant to: ${intent}. Focus on module boundaries, dependency direction, extensibility, and architectural risks.`,
    "The Artisan": `Review code quality, style, best practices, and idiomatic patterns for: ${intent}. Focus on implementation clarity, code organization, maintainability, and adherence to project conventions.`,
    "The Sentinel": `Audit security vulnerabilities, error handling, input validation, and safety for: ${intent}. Focus on OWASP Top 10, credential exposure, injection risks, and edge case robustness.`,
    "The Detective": `Perform root cause analysis for bugs and issues related to: ${intent}. Focus on fault isolation, reproduction steps, error chain analysis, and identifying systemic failures.`,
    "The Optimizer": `Analyze performance, efficiency, and resource usage for: ${intent}. Focus on algorithmic complexity, memory/CPU bottlenecks, caching strategy, and latency optimization.`,
    "The Navigator": `Map project structure, dependencies, build system, and file layout for: ${intent}. Focus on module boundaries, import cycles, build configuration, and dependency management.`,
    "The Analyst": `Perform code review and standards compliance check for: ${intent}. Focus on diff analysis, regression detection, style consistency, and adherence to project standards.`,
    "The Examiner": `Identify testing gaps, coverage deficiencies, and quality risks for: ${intent}. Focus on missing test cases, edge coverage, assertion quality, and test architecture.`,
    "The Cartographer": `Document API surfaces, interfaces, type definitions, and public contracts for: ${intent}. Focus on API completeness, documentation clarity, type safety, and backward compatibility.`,
    "The Chronicler": `Review CI/CD pipelines, workflows, automation, and tooling for: ${intent}. Focus on pipeline efficiency, reliability gaps, deployment safety, and automation opportunities.`,
    "The Diplomat": `Analyze stakeholder needs, trade-offs, and requirement clarity for: ${intent}. Focus on requirement completeness, conflicting goals, priority alignment, and communication gaps.`,
    "The Sculptor": `Identify refactoring opportunities, dead code, simplification, and technical debt for: ${intent}. Focus on code duplication, complex logic that needs decomposition, and cleanup candidates.`,
    "The Strategist": `Explore novel approaches, alternative solutions, and creative improvements for: ${intent}. Focus on breakthrough ideas, technology choices, architectural pivots, and innovation opportunities.`,
    "The Integrator": `Evaluate cross-module integration, data flow, and compatibility for: ${intent}. Focus on interface contracts, data format consistency, error propagation across boundaries, and system cohesion.`,
  }
  return t[persona.name] ?? `Analyze from ${persona.role} perspective for: ${intent}.`
}

function dynamicGoalsFor(persona: { name: string; role: string; focus: string }, intent: string): string[] {
  const base = `Analyze ${intent} from ${persona.role} perspective`
  return [
    `Identify all ${persona.focus} aspects relevant to the task`,
    `Provide specific, actionable findings with code/file references`,
    `Flag any blocking issues or high-priority concerns`,
    `Ensure no overlap with other specialists — stay within ${persona.focus}`,
    `Produce a structured report suitable for synthesis`,
  ]
}

function dynamicSynthesisFor(persona: { name: string; role: string; focus: string }): string {
  return `When synthesizing, include ${persona.name}'s findings on ${persona.focus}. Prioritize actionable ${persona.role} recommendations, flag any blocking issues, and note confidence levels for each finding.`
}

function overlapCheck(personas: Persona[]): Persona[] {
  const seen = new Set<string>()
  return personas.filter((p) => {
    const key = p.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Spawn Necessity Evaluation ─────────────────────────────────────
// Decides whether subagents are actually needed for a given task.
// Prevents wasting compute on simple tasks that the main agent handles directly.

export interface SpawnEvaluation {
  shouldSpawn: boolean
  reason: string
  suggestedCount: number
}

export function evaluateSpawnNecessity(
  result: SensorGateResult,
  prompt: string,
): SpawnEvaluation {
  const reasons: string[] = []
  let score = 0

  // 0. User-specified agent count — if the prompt explicitly requests N subagents,
  //    honor that as a hard override (up to RATE_MAX_SPAWNS).
  const userCountMatch = prompt.match(USER_AGENT_COUNT_RE)
  const userCount = userCountMatch ? Math.min(parseInt(userCountMatch[1], 10), RATE_MAX_SPAWNS) : 0
  if (userCount > 0) {
    return {
      shouldSpawn: true,
      reason: `User explicitly requested ${userCount} specialist agents`,
      suggestedCount: userCount,
    }
  }

  // 1. Social greetings — never spawn for "hello", "thanks", etc.
  if (result.is_social_greeting) {
    return { shouldSpawn: false, reason: "Social greeting — no specialists needed", suggestedCount: 0 }
  }

  // 2. Trivial mode — always skip
  if (result.mode === "TRIVIAL") {
    return { shouldSpawn: false, reason: "Trivial task — no specialists needed", suggestedCount: 0 }
  }

  // 3. selectPersonas() already determined personas are useful via tag matching.
  //    Trust that decision. Only the hard blocks above should prevent spawning.
  //    The remaining scoring just informs the suggested count.
  const uniqueDomains = new Set(result.domain_tags.filter(Boolean)).size
  const hasCodeBlocks = prompt.includes("```") || prompt.includes("src/") || prompt.includes("import ")

  // Simplicity threshold: high confidence + low risk + single domain + simple phrasing
  const simplicityPatterns = /^(fix|update|change|add|remove|bump|upgrade|downgrade)\s/i
  const isSimpleTask = result.confidence >= 0.8
    && result.risk_level === "low"
    && uniqueDomains <= 1
    && prompt.length < 500
    && (result.complexity === "low" || !result.complexity)
    && simplicityPatterns.test(prompt.trim())

  if (isSimpleTask) {
    return { shouldSpawn: false, reason: "Simple high-confidence task — agent handles directly", suggestedCount: 0 }
  }

  // Scale up count for multi-faceted tasks
  if (uniqueDomains >= 3) {
    reasons.push("Multi-domain task — benefits from specialists")
    score += 3
  } else if (uniqueDomains >= 2) {
    reasons.push("Multi-domain task")
    score += 1
  }

  if (result.risk_level === "high") {
    reasons.push("High risk — security/critical review needed")
    score += 2
  }

  // Filter "always" skills (like breakthrough-overdrive-innovation) from chain-length scoring
  const alwaysSkills = new Set(["breakthrough-overdrive-innovation", "pieces-ltm", "automated-learning", "lint-fixer", "context-compactor"])
  const effectiveChainLen = result.chain.filter((s) => !alwaysSkills.has(s)).length
  if (effectiveChainLen >= 2) {
    reasons.push("Complex skill chain — parallel analysis beneficial")
    score += effectiveChainLen >= 4 ? 3 : 2
  }

  if (result.mode === "DREAM_INNOVATION") {
    reasons.push("Innovation mode — creative analysis from multiple perspectives")
    score += 2
  }

  if (hasCodeBlocks && prompt.length > 200) {
    reasons.push("Code-heavy prompt — benefits from structured specialist review")
    score += 1
  }

  // Allow zero specialists for simple tasks
  // NOTE: score 0 → ceil(0/2) = 0 (no spawns). score 1 → ceil(1/2) = 1. score 2 → ceil(2/2) = 1.
  const suggestedCount = Math.min(5, Math.max(0, Math.ceil(score / 2)))

  return {
    shouldSpawn: suggestedCount > 0,
    reason: reasons.join("; ") || "Specialist analysis will provide focused coverage",
    suggestedCount,
  }
}

function depthScore(result: SensorGateResult): number {
  // Compute task depth from multiple signals on a 1-5 scale
  const tags = result.domain_tags.filter(Boolean).length
  const chainLen = result.chain.filter(Boolean).length
  const risk = result.risk_level === "high" ? 3 : result.risk_level === "medium" ? 2 : 1
  const tagDiversity = Math.min(tags, 5)
  const chainDepth = Math.min(chainLen, 4)
  return Math.max(0, Math.min(5, Math.ceil((risk + tagDiversity + chainDepth) / 3)))
}

function selectPersonas(result: SensorGateResult): Persona[] {
  const tags = new Set(result.domain_tags.map((t) => t.trim().toLowerCase()))
  const chain = new Set(result.chain.map((s) => s.trim().toLowerCase()))
  const allTags = new Set([...tags, ...chain])

  const mode = result.mode
  const complexityScore = result.risk_level === "high" ? 3 : result.risk_level === "medium" ? 2 : 1

  // Score each profile by relevance
  const scored = PERSONA_PROFILES.map((profile) => {
    let score = 0
    for (const tag of profile.tags) {
      if (allTags.has(tag)) score += 2
      else if (chain.has(tag)) score += 1
    }
    if (complexityScore < profile.minComplexity) score -= 3
    if (mode === "DREAM_INNOVATION") score += 1
    return { profile, score }
  })

  // Raise minimum score threshold — require at least 2 tag matches to justify a persona
  const eligible = scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score)

  // For simple/low-risk tasks, skip personas entirely
  if (complexityScore <= 1 && mode !== "DREAM_INNOVATION" && eligible.length === 0) {
    return []
  }

  // Deduplicate personas with overlapping focus areas
  const deduped: typeof eligible = []
  for (const candidate of eligible) {
    const hasOverlap = deduped.some((existing) => {
      const overlap = candidate.profile.tags.filter((t) => existing.profile.tags.includes(t))
      return overlap.length >= Math.ceil(Math.min(candidate.profile.tags.length, existing.profile.tags.length) * 0.6)
    })
    if (!hasOverlap) deduped.push(candidate)
  }

  // Dynamic depth-based count — now supports 0 specialists for simple tasks
  const dd = depthScore(result)
  let count: number
  if (mode === "DREAM_INNOVATION") {
    count = Math.min(5, Math.max(1, Math.ceil(dd * 1.2)))
  } else if (mode === "TRIVIAL") {
    count = 0
  } else {
    count = Math.min(4, Math.max(0, Math.ceil(dd)))
  }
  count = Math.min(count, deduped.length)

  if (count < 1) return []

  return overlapCheck(deduped.slice(0, count).map((s) => ({
    name: s.profile.name,
    role: s.profile.role,
    focus: s.profile.focus,
    skills: s.profile.skills,
    task: dynamicTaskFor(s.profile, result.intent),
    goals: dynamicGoalsFor(s.profile, result.intent),
    synthesisGuide: dynamicSynthesisFor(s.profile),
  })))
}

export interface SensorGateResult {
  intent: string
  domain_tags: string[]
  risk_level: string
  confidence: number
  complexity: string
  time_sensitivity: string
  requires_tools: string
  deliverable_type: string
  is_social_greeting: boolean
  primary_skill: string
  support_skills: string[]
  automation: string
  mode: string
  chain: string[]
  personas: Persona[]
  guardian_decision: string
  guardian_risk: string
  skill_plan: string
  raw_output: string
  neuro_result?: string
}

// ---------------------------------------------------------------------------
// Sensor Gate Output Parser
// ---------------------------------------------------------------------------

const PARSERS: Record<string, (line: string, r: SensorGateResult) => void> = {
  "- intent:": (l, r) => { r.intent = l.slice("- intent:".length).trim() },
  "- domain_tags:": (l, r) => {
    r.domain_tags = l.slice("- domain_tags:".length).trim().split(",").map((t) => t.trim()).filter(Boolean)
  },
  "- risk_level:": (l, r) => { r.risk_level = l.slice("- risk_level:".length).trim() },
  "- confidence:": (l, r) => {
    const val = parseFloat(l.slice("- confidence:".length))
    r.confidence = Number.isFinite(val) ? val : 0.5
  },
  "- complexity:": (l, r) => { r.complexity = l.slice("- complexity:".length).trim() },
  "- time_sensitivity:": (l, r) => { r.time_sensitivity = l.slice("- time_sensitivity:".length).trim() },
  "- requires_tools:": (l, r) => { r.requires_tools = l.slice("- requires_tools:".length).trim() },
  "- deliverable_type:": (l, r) => { r.deliverable_type = l.slice("- deliverable_type:".length).trim() },
  "- is_social_greeting:": (l, r) => { r.is_social_greeting = l.slice("- is_social_greeting:".length).trim() === "true" },
  "- primary:": (l, r) => { r.primary_skill = l.slice("- primary:".length).trim() },
  "- supports:": (l, r) => {
    r.support_skills = l.slice("- supports:".length).trim().split(",").map((s) => s.trim()).filter(Boolean)
  },
  "- automation:": (l, r) => { r.automation = l.slice("- automation:".length).trim() },
  "- mode:": (l, r) => { r.mode = l.slice("- mode:".length).trim() },
  "- chain:": (l, r) => {
    r.chain = l.slice("- chain:".length).trim().split("→").map((s) => s.trim()).filter(Boolean)
  },
  "- decision:": (l, r) => { r.guardian_decision = l.slice("- decision:".length).trim() },
}

export function parseSensorGateOutput(output: string): SensorGateResult {
  const lines = output.split("\n")
  const result: SensorGateResult = {
    intent: "",
    domain_tags: [],
    risk_level: "medium",
    confidence: 0.5,
    complexity: "medium",
    time_sensitivity: "medium",
    requires_tools: "files",
    deliverable_type: "multi",
    is_social_greeting: false,
    primary_skill: "",
    support_skills: [],
    automation: "none",
    mode: "STANDARD",
    chain: [],
    personas: [],
    guardian_decision: "APPROVED",
    guardian_risk: "low",
    skill_plan: "",
    raw_output: output,
  }

  for (const line of lines) {
    const trimmed = line.trim()

    for (const [prefix, parse] of Object.entries(PARSERS)) {
      if (trimmed.startsWith(prefix)) { parse(trimmed, result); break }
    }
  }
  const guardianHeaderIndex = lines.findIndex((l) => l.includes("[GUARDIAN]"))
  if (guardianHeaderIndex >= 0) {
    for (const line of lines.slice(guardianHeaderIndex)) {
      const trimmed = line.trim()
      if (trimmed.startsWith("- risk_level:")) {
        result.guardian_risk = trimmed.slice(13).trim()
        break
      }
    }
  }

  // Extract Skill Plan block
  const skillPlanStart = output.indexOf("Skill Plan:")
  if (skillPlanStart !== -1) {
    const skillPlanEnd = output.indexOf("=", skillPlanStart)
    result.skill_plan = skillPlanEnd !== -1
      ? output.slice(skillPlanStart, skillPlanEnd).trim()
      : output.slice(skillPlanStart).trim()
  }

  // Extract Persona block
  const personaStart = output.indexOf("[PERSONA] Dynamic Agent Personas")
  if (personaStart !== -1) {
    const personaEnd = output.indexOf("[", personaStart + 1)
    const personaBlock = personaEnd !== -1
      ? output.slice(personaStart, personaEnd).trim()
      : output.slice(personaStart).trim()

    const personaLines = personaBlock.split("\n")
    let currentPersona: Partial<Persona> | null = null

    for (const line of personaLines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("- name:")) {
        if (currentPersona?.name) {
          result.personas.push(currentPersona as Persona)
        }
        currentPersona = { name: trimmed.slice(7).trim(), role: "", focus: "", skills: [] }
      } else if (trimmed.startsWith("role:") && currentPersona) {
        currentPersona.role = trimmed.slice(5).trim()
      } else if (trimmed.startsWith("focus:") && currentPersona) {
        currentPersona.focus = trimmed.slice(6).trim()
      } else if (trimmed.startsWith("skills:") && currentPersona) {
        currentPersona.skills = trimmed.slice(7).trim().split(",").map(s => s.trim()).filter(Boolean)
      }
    }
    if (currentPersona?.name) {
      result.personas.push(currentPersona as Persona)
    }
  }

  return result
}

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"

function resolveSkillsDir(): string {
  const candidates = [
    path.join(HOME, ".config", "dreamcode", "skills"),
    path.join(HOME, ".dreamcode", "skills"),
    path.join(process.cwd(), ".dreamcode", "skills"),
    path.join(process.cwd(), ".opencode", "skills"),
  ]
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
    } catch (e) {
      console.warn(`[sensor-gate] error checking skills dir ${dir}:`, e)
    }
  }
  return candidates[0]
}

function resolveScript(relativePath: string): string | undefined {
  const skillsDir = resolveSkillsDir()
  const candidates = [
    path.join(skillsDir, relativePath),
    path.join(process.cwd(), ".dreamcode", "skills", relativePath),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch (e) {
      console.warn(`[sensor-gate] error checking script path ${p}:`, e)
    }
  }
  return undefined
}

const VALID_SCAN_TYPES = new Set(["security", "full_audit", "bug_hunt", "test_gap"])

const INITIAL_TIMEOUT_MS = 150_000
const RETRY_TIMEOUT_MS = 300_000

/** Shared retry-with-timeout: runs the effect with INITIAL_TIMEOUT, then RETRY_TIMEOUT on null. */
function retryWithTimeout<T>(run: (timeoutMs: number) => Effect.Effect<T | null>): Effect.Effect<T | null> {
  return run(INITIAL_TIMEOUT_MS).pipe(
    Effect.flatMap((first) => {
      if (first !== null) return Effect.succeed(first)
      return run(RETRY_TIMEOUT_MS)
    }),
  )
}

function runSensorGateEffect(
  prompt: string,
  projectRoot: string,
): Effect.Effect<SensorGateResult | null> {
  const sensorGate = resolveScript("chain-orchestrator/scripts/sensor_gate.py")
  if (!sensorGate) return Effect.succeed(null)

  const clamped = prompt.length > SAFE_PROMPT_MAX
    ? prompt.slice(0, SAFE_PROMPT_MAX) + "\n\n[Prompt truncated at 100K characters]"
    : prompt

  const runWithTimeout = (timeoutMs: number) =>
    Effect.gen(function* () {
      const output = yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(["python3", sensorGate, "--stdin"], {
            cwd: projectRoot,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          })
          const writer = proc.stdin.getWriter()
          await writer.write(new TextEncoder().encode(clamped))
          await writer.close()
          return await new Response(proc.stdout).text()
        },
        catch: () => "" as string,
      }).pipe(
        Effect.timeout(Duration.millis(timeoutMs)),
        Effect.catch(() => Effect.succeed("")),
      )
      if (!output) return null
      return parseSensorGateOutput(output)
    }).pipe(
      Effect.catch((e) => {
        console.warn("[sensor-gate] runSensorGate subprocess failed", { error: String(e), timeoutMs })
        return Effect.succeed(null) as Effect.Effect<SensorGateResult | null>
      }),
    )

  return retryWithTimeout(runWithTimeout)
}

function validateNeuroOutput(output: string): string | null {
  try {
    const parsed = JSON.parse(output)
    if (typeof parsed !== "object" || parsed === null) return null
    const safe = JSON.stringify(parsed).slice(0, 50_000)
    return safe
  } catch {
    return output.slice(0, 10_000)
  }
}

function runNeuroHarnessEffect(
  prompt: string,
  projectRoot: string,
  scanType: string,
  classification?: { intent: string; mode: string; chain: string[]; risk_level: string; confidence: number; domain_tags: string[] },
): Effect.Effect<string | null> {
  const neuroHarness = resolveScript("neuro/scripts/neuro_harness.py")
  if (!neuroHarness) return Effect.succeed(null)

  const clamped = prompt.length > SAFE_PROMPT_MAX
    ? prompt.slice(0, SAFE_PROMPT_MAX) + "\n\n[Prompt truncated at 100K characters]"
    : prompt

  const runWithTimeout = (timeoutMs: number) =>
    Effect.gen(function* () {
      const tmpBase = process.env.XDG_RUNTIME_DIR
        ? path.join(process.env.XDG_RUNTIME_DIR, "dreamcode")
        : path.join(projectRoot, ".dreamcode", "tmp")
      try { fs.mkdirSync(tmpBase, { recursive: true }) } catch (e) {
        console.warn("[sensor-gate] failed to create tmp base dir", { error: String(e), tmpBase })
      }
      const tmpDir = fs.mkdtempSync(path.join(tmpBase, "neuro-"))
      fs.chmodSync(tmpDir, 0o700)
      const tmpFile = path.join(tmpDir, "prompt.txt")
      try {
        const promptResult = buildPrompt({
          scanType,
          files: [{ path: "user_prompt", content: clamped }],
          context: clamped.slice(0, 8000),
        })

        fs.writeFileSync(tmpFile, promptResult.userPrompt, { mode: 0o600 })

        const automationContext = JSON.stringify({
          task: clamped,
          classification,
        })

        const output = yield* Effect.tryPromise({
          try: async () => {
            const proc = Bun.spawn([
              "python3",
              neuroHarness,
              "--scan-type", scanType,
              "--file", tmpFile,
              "--task", clamped.slice(0, 8000),
              "--automation-context", automationContext,
            ], {
              cwd: projectRoot,
              stdio: ["pipe", "pipe", "pipe"],
            })
            return await new Response(proc.stdout).text()
          },
          catch: () => "" as string,
        }).pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catch(() => Effect.succeed("")),
        )
        return output || null
      } catch (e) {
        console.warn("[sensor-gate] runNeuroHarness subprocess failed", { error: String(e), timeoutMs })
        return null
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      }
    }).pipe(
      Effect.catch(() => Effect.succeed(null) as Effect.Effect<string | null>),
    )

  return retryWithTimeout(runWithTimeout)
}

export interface Interface {
  readonly classify: (prompt: string) => Effect.Effect<SensorGateResult | null>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SensorGate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      classify: Effect.fn("SensorGate.classify")(function* (prompt: string) {
        const ctx = yield* InstanceState.contextOrNull
        if (!ctx?.directory) return null
        const directory = ctx.directory
        const result = yield* runSensorGateEffect(prompt, directory)
        if (!result) return null

        // Generate personas from TypeScript when Python script doesn't output them
        if (result.personas.length === 0) {
          result.personas = selectPersonas(result)
        } else {
          // Fill in dynamic task/goals/synthesisGuide for Python-provided personas
          result.personas = result.personas.map((p) => {
            const profile = PERSONA_PROFILES.find((pp) => pp.name === p.name)
            const name = p.name
            const role = p.role
            const focus = p.focus
            return {
              ...p,
              task: p.task || (profile ? dynamicTaskFor(profile, result.intent) : `Analyze from ${role} perspective for: ${result.intent}.`),
              goals: p.goals?.length ? p.goals : (profile ? dynamicGoalsFor(profile, result.intent) : [`Identify all ${focus} aspects`, `Provide actionable findings`]),
              synthesisGuide: p.synthesisGuide || (profile ? dynamicSynthesisFor(profile) : `Include ${name} findings on ${focus}.`),
            }
          }).slice(0, RATE_MAX_SPAWNS)
          // Trust Python and TS persona selection — no floor padding
        }

        // Detect explicit user request for N agents and ensure enough personas
        const userCountMatch = prompt.match(USER_AGENT_COUNT_RE)
        const explicitCount = userCountMatch ? Math.min(parseInt(userCountMatch[1], 10), RATE_MAX_SPAWNS) : 0
        if (explicitCount > 0 && result.personas.length < explicitCount) {
          const defaults = PERSONA_PROFILES.filter((p) =>
            !result.personas.find((pp) => pp.name === p.name)
          )
          for (const d of defaults) {
            if (result.personas.length >= explicitCount) break
            result.personas.push({
              name: d.name, role: d.role, focus: d.focus, skills: d.skills,
              task: dynamicTaskFor(d, result.intent),
              goals: dynamicGoalsFor(d, result.intent),
              synthesisGuide: dynamicSynthesisFor(d),
            })
          }
        }

        // Run NEURO for ALL non-trivial tasks — neuro is cheap (Python harness, no LLM cost)
        // Only skip for trivial mode and social greetings
        const shouldRunNeuro = result.mode !== "TRIVIAL" && !result.is_social_greeting

        if (shouldRunNeuro) {
          const scanType = result.risk_level === "high" ? "security" : "full_audit"
          const neuroResult = yield* runNeuroHarnessEffect(prompt, directory, scanType, {
            intent: result.intent,
            mode: result.mode,
            chain: result.chain,
            risk_level: result.risk_level,
            confidence: result.confidence,
            domain_tags: result.domain_tags,
          })
          if (neuroResult) {
            if (neuroResult.includes('"status": "skipped"') || neuroResult.includes('"status":"skipped"')) {
              console.warn("[sensor-gate] NEURO analysis skipped — NEURO_API_KEY not set. Sign up at https://neurometric.ai to get your free API key.")
            } else {
              const validated = validateNeuroOutput(neuroResult)
              if (validated) result.neuro_result = validated
            }
          }
        }

        // Per-persona NEURO enrichment — enrich ALL personas since neuro is cheap
        // This gives each specialist agent its own tailored architectural analysis
        if (result.personas.length > 0 && shouldRunNeuro) {
          for (const persona of result.personas) {
            const scanType = PERSONA_SCAN_TYPE_MAP[persona.name] || "full_audit"
            const personaTask = `${persona.role}: ${prompt}`
            const neuroResult = yield* runNeuroHarnessEffect(personaTask, directory, scanType, {
              intent: result.intent,
              mode: result.mode,
              chain: result.chain,
              risk_level: result.risk_level,
              confidence: result.confidence,
              domain_tags: result.domain_tags,
            })
            if (neuroResult) {
              const validated = validateNeuroOutput(neuroResult)
              if (validated) persona.neuroResult = validated
            }
          }
        }

        return result
      }),
    })
  }),
)

export const defaultLayer = layer

export * as SensorGate from "./sensor-gate"

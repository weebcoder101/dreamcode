import { Effect, Context, Layer } from "effect"
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { InstanceState } from "@/effect/instance-state"
import { buildPrompt } from "./prompt-engine"

export interface Persona {
  name: string
  role: string
  focus: string
  skills: string[]
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
    tags: ["review", "audit", "examine", "inspect", "refactoring"],
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
    // Penalize if below complexity threshold
    if (complexityScore < profile.minComplexity) score -= 3
    // Boost for DREAM_INNOVATION mode
    if (mode === "DREAM_INNOVATION") score += 1
    return { profile, score }
  })

  // Sort by score descending, filter out negatives
  const eligible = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)

  // Determine count based on mode and complexity
  let count: number
  if (mode === "DREAM_INNOVATION") {
    count = Math.min(7, Math.max(4, Math.ceil(complexityScore * 2)))
  } else if (mode === "TRIVIAL") {
    count = Math.min(2, eligible.length)
  } else {
    count = Math.min(5, Math.max(2, complexityScore * 2))
  }
  count = Math.min(count, eligible.length, 7)

  if (count === 0) {
    // Fallback: include at least 2 default personas
    const defaults = PERSONA_PROFILES.filter((p) => p.minComplexity <= 1)
    const picked = defaults.slice(0, Math.min(2, defaults.length))
    return picked.map((p) => ({ name: p.name, role: p.role, focus: p.focus, skills: p.skills }))
  }

  return eligible.slice(0, count).map((s) => ({
    name: s.profile.name,
    role: s.profile.role,
    focus: s.profile.focus,
    skills: s.profile.skills,
  }))
}

export interface SensorGateResult {
  intent: string
  domain_tags: string[]
  risk_level: string
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

function parseSensorGateOutput(output: string): SensorGateResult {
  const lines = output.split("\n")
  const result: SensorGateResult = {
    intent: "",
    domain_tags: [],
    risk_level: "medium",
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

    // Intent Classification
    if (trimmed.startsWith("- intent:")) result.intent = trimmed.slice(10).trim()
    if (trimmed.startsWith("- domain_tags:")) {
      const tags = trimmed.slice(14).trim()
      result.domain_tags = tags.split(",").map((t) => t.trim()).filter(Boolean)
    }
    if (trimmed.startsWith("- risk_level:")) result.risk_level = trimmed.slice(13).trim()
    if (trimmed.startsWith("- time_sensitivity:")) result.time_sensitivity = trimmed.slice(19).trim()
    if (trimmed.startsWith("- requires_tools:")) result.requires_tools = trimmed.slice(17).trim()
    if (trimmed.startsWith("- deliverable_type:")) result.deliverable_type = trimmed.slice(19).trim()
    if (trimmed.startsWith("- is_social_greeting:")) {
      result.is_social_greeting = trimmed.slice(21).trim() === "true"
    }

    // Skill Resolution
    if (trimmed.startsWith("- primary:")) result.primary_skill = trimmed.slice(10).trim()
    if (trimmed.startsWith("- supports:")) {
      const skills = trimmed.slice(11).trim()
      result.support_skills = skills.split(",").map((s) => s.trim()).filter(Boolean)
    }
    if (trimmed.startsWith("- automation:")) result.automation = trimmed.slice(13).trim()
    if (trimmed.startsWith("- mode:")) result.mode = trimmed.slice(7).trim()
    if (trimmed.startsWith("- chain:")) {
      const chain = trimmed.slice(8).trim()
      result.chain = chain.split("→").map((s) => s.trim()).filter(Boolean)
    }

    // Guardian AI
    if (trimmed.startsWith("- decision:")) result.guardian_decision = trimmed.slice(11).trim()
    if (trimmed.startsWith("- risk_level:") && lines.indexOf(line) > lines.findIndex((l) => l.includes("[GUARDIAN]"))) {
      result.guardian_risk = trimmed.slice(13).trim()
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

function runSensorGate(prompt: string, projectRoot: string): SensorGateResult | null {
  const skillsDir = path.join(projectRoot, ".dreamcode", "skills")
  const sensorGate = path.join(skillsDir, "chain-orchestrator", "scripts", "sensor_gate.py")

  if (!fs.existsSync(sensorGate)) return null

  const tryRun = (timeoutMs: number): SensorGateResult | null => {
    try {
      const output = execFileSync("python3", [sensorGate, "--prompt", prompt], {
        encoding: "utf8",
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: projectRoot,
      })
      return parseSensorGateOutput(output)
    } catch (e) {
      return null
    }
  }

  const result = tryRun(200_000)
  if (result) return result
  return tryRun(400_000)
}

function runNeuroHarness(prompt: string, projectRoot: string, scanType: string): string | null {
  const skillsDir = path.join(projectRoot, ".dreamcode", "skills")
  const neuroHarness = path.join(skillsDir, "neuro", "scripts", "neuro_harness.py")

  if (!fs.existsSync(neuroHarness)) return null

  const tryRun = (timeoutMs: number): string | null => {
      // Create a temp file with a unique name to avoid race conditions
    const tmpDir = path.join(projectRoot, ".dreamcode", "tmp")
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)
    try {
      // Build prompt using TypeScript prompt engine
      const promptResult = buildPrompt({
        scanType,
        files: [{ path: "user_prompt", content: prompt }],
        context: prompt.slice(0, 500),
      })

      fs.writeFileSync(tmpFile, promptResult.userPrompt)

      const output = execFileSync("python3", [
        neuroHarness,
        "--scan-type", scanType,
        "--file", tmpFile,
        "--task", prompt.slice(0, 200),
      ], {
        encoding: "utf8",
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: projectRoot,
      })

      // Clean up temp file
      try { fs.unlinkSync(tmpFile) } catch {}
      return output
    } catch (e) {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile) } catch {}
      return null
    }
  }

  const result = tryRun(200_000)
  if (result) return result
  return tryRun(400_000)
}

export interface Interface {
  readonly classify: (prompt: string) => Effect.Effect<SensorGateResult | null>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SensorGate") {}

export const layer = Layer.succeed(Service, Service.of({
  classify: Effect.fn("SensorGate.classify")(function* (prompt: string) {
    const ctx = yield* InstanceState.contextOrNull
    const directory = ctx?.directory ?? process.cwd()
    const result = runSensorGate(prompt, directory)
    if (!result) return null

    // Generate personas from TypeScript when Python script doesn't output them
    if (result.personas.length === 0) {
      result.personas = selectPersonas(result)
    } else if (result.personas.length > 7) {
      result.personas = result.personas.slice(0, 7)
    }

    const shouldRunNeuro = result.risk_level === "high" ||
      result.mode === "DREAM_INNOVATION" ||
      result.chain.length > 3

    if (shouldRunNeuro) {
      const scanType = result.risk_level === "high" ? "security" : "full_audit"
      const neuroResult = runNeuroHarness(prompt, directory, scanType)
      if (neuroResult) {
        result.neuro_result = neuroResult
      }
    }

    // Per-persona NEURO enrichment
    if (result.personas.length > 0 && shouldRunNeuro) {
      const maxEnriched = result.risk_level === "high" ? result.personas.length : Math.min(3, result.personas.length)
      for (let i = 0; i < maxEnriched; i++) {
        const persona = result.personas[i]
        const scanType = PERSONA_SCAN_TYPE_MAP[persona.name] || "full_audit"
        const personaTask = `${persona.role}: ${prompt}`
        const neuroResult = runNeuroHarness(personaTask, directory, scanType)
        if (neuroResult) {
          persona.neuroResult = neuroResult
        }
      }
    }

    return result
  }),
}))

export const defaultLayer = layer

export * as SensorGate from "./sensor-gate"

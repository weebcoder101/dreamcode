import { Effect, Context, Layer, Duration } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Skill } from "@/skill"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import fs from "fs"
import { resolvePythonCommand, getPythonArgs, resolveSkillsDir, HOME } from "./python-resolver"

function isUnderPrefix(realpath: string, allowedPrefix: string): boolean {
  // Normalize: ensure prefix ends with separator to prevent sibling-directory escape
  // e.g. prefix "/home/user/.dreamcode/skills" should NOT match "/home/user/.dreamcode/skills-evil"
  const normalized = allowedPrefix.endsWith(path.sep) ? allowedPrefix : allowedPrefix + path.sep
  return realpath === allowedPrefix || realpath.startsWith(normalized)
}

export function validateScriptPath(resolved: string, cwd?: string): boolean {
  if (!resolved || !path.isAbsolute(resolved)) return false
  // Resolve symlinks before checking to prevent sandbox escape
  let realpath: string
  try {
    realpath = fs.realpathSync(resolved)
  } catch {
    // realpathSync throws when the file doesn't exist or permission denied.
    // path.resolve does NOT resolve `..` segments — reject traversal patterns.
    realpath = path.resolve(resolved)
    if (realpath.includes("..")) return false
  }
  const skillsDir = resolveSkillsDir()
  const allowedGlobal = skillsDir ? path.resolve(skillsDir) : null
  const allowedHome = path.resolve(HOME, ".dreamcode", "skills")
  const allowedProject = path.resolve(cwd ?? process.cwd(), ".dreamcode", "skills")
  return (
    (allowedGlobal !== null && isUnderPrefix(realpath, allowedGlobal)) ||
    isUnderPrefix(realpath, allowedHome) ||
    isUnderPrefix(realpath, allowedProject)
  )
}

export interface ChainResult {
  name: string
  output: string
  status: "ok" | "not_found" | "error"
}

export interface Interface {
  readonly execute: (
    chain: string[],
    userPrompt: string,
  ) => Effect.Effect<ChainResult[]>
  readonly runFullPipeline: (
    chain: string[],
    userPrompt: string,
  ) => Effect.Effect<ChainResult[]>
  readonly verify: (
    results: ChainResult[],
  ) => Effect.Effect<string>
}

const discoverScripts = Effect.fn("ChainExecutor.discoverScripts")(function* (skillLocation: string) {
  const dir = path.dirname(skillLocation)
  return yield* Effect.tryPromise({
    try: () => Glob.scan("scripts/*.py", { cwd: dir, absolute: true }),
    catch: () => [] as string[],
  }).pipe(Effect.map((scripts) => scripts as string[]))
})

const runPythonScript = Effect.fn("ChainExecutor.runPythonScript")(function* (
  script: string,
  prompt: string,
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script), cwd)) {
    return "[SKIPPED] Script path outside allowed skills directory"
  }
  // Pass prompt as --prompt argument instead of piping via stdin.
  // Bun.spawn creates Unix domain sockets (not pipes) in compiled binaries,
  // and writer.close() doesn't send EOF through them, causing Python's
  // sys.stdin.read() to block forever. --prompt arg avoids this entirely.
  // Most skill scripts already support --prompt (required=True).
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([pythonCmd, ...versionArgs, script, "--prompt", prompt], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await proc.stdout.text()
      await proc.exited
      return text || ""
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(150)),
    Effect.catch(() => {
      console.warn("[chain-executor] python script timed out", { script })
      return Effect.succeed("")
    }),
  )
})

const runPythonScriptAdvanced = Effect.fn("ChainExecutor.runPythonScriptAdvanced")(function* (
  script: string,
  args: string[],
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script), cwd)) {
    return ""
  }
  // Cross-platform Python resolution
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  return yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([pythonCmd, ...versionArgs, script, ...args], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await proc.stdout.text()
      await proc.exited
      return text || ""
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(300)),
    Effect.catch(() => {
      console.warn("[chain-executor] advanced python script timed out", { script })
      return Effect.succeed("")
    }),
  )
})

export const execute = Effect.fn("ChainExecutor.execute")(function* (
  chain: string[],
  userPrompt: string,
) {
  const skillService = yield* Skill.Service
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const results: ChainResult[] = []

  for (const skillName of chain) {
    const skillInfo = yield* skillService.require(skillName).pipe(Effect.option)
    if (skillInfo._tag === "None") {
      results.push({ name: skillName, output: "", status: "not_found" })
      continue
    }

    const skill = skillInfo.value
    // Discover Python scripts in the skill's scripts/ directory
    const scripts = yield* discoverScripts(skill.location)

    if (scripts.length === 0) {
      // No script to execute — inject skill content as passive result
      results.push({
        name: skillName,
        output: skill.content,
        status: "ok",
      })
      continue
    }

    // Execute the first discovered script
    const script = scripts[0]
    const result = yield* runPythonScript(script, userPrompt, cwd).pipe(
      Effect.catch((err) =>
        Effect.succeed(`[ERROR] Script execution failed: ${err}`)
      ),
    )

    results.push({
      name: skillName,
      output: result || "[SKILL EXECUTED: no output]",
      status: result ? "ok" : "error",
    })
  }

  return results
})

export const runFullPipeline = Effect.fn("ChainExecutor.runFullPipeline")(function* (
  chain: string[],
  userPrompt: string,
) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    console.warn("[chain-executor] skills directory not found, skipping pipeline")
    return []
  }
  const executorScript = path.join(skillsDir, "chain-orchestrator", "scripts", "orchestrator.py")

  // Run the full pipeline — caller already handles normal chain execution via execute()
  // to prevent double execution of skill scripts.
  const results: ChainResult[] = []

  // If the Python executor script exists, run the full pipeline
  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(executorScript).exists(),
      catch: () => false,
    })
    if (exists) {
      const pipelineResult = yield* runPythonScriptAdvanced(
        executorScript,
        ["--mode", chain.length > 3 ? "DREAM_INNOVATION" : "STANDARD", "--prompt", userPrompt],
        cwd,
      ).pipe(
        Effect.catch(() => {
          console.warn("[chain-executor] pipeline script timed out or failed", { path: executorScript })
          return Effect.succeed("")
        }),
      )
      if (pipelineResult) {
        results.push({
          name: "chain-executor-pipeline",
          output: pipelineResult,
          status: "ok",
        })
      }
    }
  } catch (e) {
    console.warn("[chain-executor] pipeline script not available", { path: executorScript, error: String(e) })
  }

  return results
})

export const verify = Effect.fn("ChainExecutor.verify")(function* (results: ChainResult[]) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    console.warn("[chain-executor] skills directory not found, skipping verify")
    return ""
  }
  const enforcerScript = path.join(skillsDir, "chain-orchestrator", "scripts", "enforcer.py")

  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(enforcerScript).exists(),
      catch: () => false,
    })
    if (!exists) {
      console.warn("[chain-executor] enforcer script not found, skipping verify", { path: enforcerScript })
      return ""
    }

    const summary = results
      .map((r) => `${r.name}: ${r.status}`)
      .join("\n")

    const verifierResult = yield* runPythonScriptAdvanced(
      enforcerScript,
      ["--results", summary],
      cwd,
    ).pipe(
      Effect.catch(() => {
        console.warn("[chain-executor] verifier script timed out or failed", { path: enforcerScript })
        return Effect.succeed("")
      }),
    )

    return verifierResult || ""
  } catch (e) {
    console.warn("[chain-executor] verify failed", { error: String(e) })
    return ""
  }
})

export class Service extends Context.Service<Service, Interface>()("@dreamcode/ChainExecutor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      execute: (chain, userPrompt) => execute(chain, userPrompt),
      runFullPipeline: (chain, userPrompt) => runFullPipeline(chain, userPrompt),
      verify: (results) => verify(results),
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export const ChainExecutor = { Service, layer, defaultLayer, node, validateScriptPath }

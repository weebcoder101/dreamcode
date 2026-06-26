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
  } catch (error) {
    // Differentiate between ENOENT (normal — file doesn't exist yet) and
    // other errors (symlink loops, permission denied) which are real problems.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== "ENOENT") {
      console.warn("[chain-executor] Unexpected realpath error", resolved, error)
    }
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
    return { output: "[SKIPPED] Script path outside allowed skills directory", exitCode: 0 }
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
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PYTHONPATH: process.env.PYTHONPATH ?? "",
          NEURO_API_KEY: process.env.NEUCODE_NEURO_API_KEY ?? process.env.NEURO_API_KEY ?? "",
          PROJECT_ROOT: cwd,
        },
      })
      const stdoutPromise = proc.stdout.text()
      const stderrPromise = proc.stderr.text()
      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise
      if (exitCode !== 0) {
        const detail = (stderr || stdout || "").slice(0, 500)
        console.warn("[chain-executor] script exited non-zero", { script, exitCode, detail })
        return { output: `[ERROR] Exit code ${exitCode}: ${detail}`, exitCode }
      }
      return { output: stdout || "", exitCode: 0 }
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(150)),
    Effect.catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn("[chain-executor] python script failed", { script, error: msg })
      return Effect.succeed({ output: `[ERROR] ${msg}`, exitCode: -1 })
    }),
  )
})

const runPythonScriptAdvanced = Effect.fn("ChainExecutor.runPythonScriptAdvanced")(function* (
  script: string,
  args: string[],
  cwd: string,
) {
  if (!validateScriptPath(path.resolve(script), cwd)) {
    return { output: "", exitCode: 0 }
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
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PYTHONPATH: process.env.PYTHONPATH ?? "",
          NEURO_API_KEY: process.env.NEUCODE_NEURO_API_KEY ?? process.env.NEURO_API_KEY ?? "",
          PROJECT_ROOT: cwd,
        },
      })
      const stdoutPromise = proc.stdout.text()
      const stderrPromise = proc.stderr.text()
      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise
      if (exitCode !== 0) {
        const detail = (stderr || stdout || "").slice(0, 500)
        console.warn("[chain-executor] advanced script exited non-zero", { script, exitCode, detail })
        return { output: `[ERROR] Exit code ${exitCode}: ${detail}`, exitCode }
      }
      return { output: stdout || "", exitCode: 0 }
    },
    catch: (err) => new Error(String(err)),
  }).pipe(
    Effect.timeout(Duration.seconds(300)),
    Effect.catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn("[chain-executor] advanced python script failed", { script, error: msg })
      return Effect.succeed({ output: `[ERROR] ${msg}`, exitCode: -1 })
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
    const scriptResult = yield* runPythonScript(script, userPrompt, cwd)

    if (scriptResult.exitCode !== 0) {
      // Script crashed or was killed — propagate the error detail
      results.push({
        name: skillName,
        output: scriptResult.output || `[ERROR] Script ${script} exited with code ${scriptResult.exitCode}`,
        status: "error",
      })
    } else {
      results.push({
        name: skillName,
        output: scriptResult.output || "[SKILL EXECUTED: no output]",
        status: scriptResult.output ? "ok" : "error",
      })
    }
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
    if (!exists) {
      results.push({
        name: "chain-executor-pipeline",
        output: `[WARNING] Pipeline orchestrator not found: ${executorScript}`,
        status: "error",
      })
      return results
    }
    const pipelineResult = yield* runPythonScriptAdvanced(
      executorScript,
      ["--mode", chain.length > 3 ? "DREAM_INNOVATION" : "STANDARD", "--prompt", userPrompt],
      cwd,
    )
    if (pipelineResult.exitCode !== 0) {
      results.push({
        name: "chain-executor-pipeline",
        output: pipelineResult.output || `[ERROR] Pipeline script exited with code ${pipelineResult.exitCode}`,
        status: "error",
      })
    } else if (pipelineResult.output) {
      results.push({
        name: "chain-executor-pipeline",
        output: pipelineResult.output,
        status: "ok",
      })
    }
  } catch (e) {
    results.push({
      name: "chain-executor-pipeline",
      output: `[ERROR] Pipeline execution failed: ${String(e)}`,
      status: "error",
    })
  }

  return results
})

export const verify = Effect.fn("ChainExecutor.verify")(function* (results: ChainResult[]) {
  const ctx = yield* InstanceState.contextOrNull
  const cwd = ctx?.directory ?? process.cwd()
  const skillsDir = resolveSkillsDir()
  if (!skillsDir) {
    return "[WARNING] Skills directory not found — verify skipped"
  }
  const enforcerScript = path.join(skillsDir, "chain-orchestrator", "scripts", "enforcer.py")

  try {
    const exists = yield* Effect.tryPromise({
      try: () => Bun.file(enforcerScript).exists(),
      catch: () => false,
    })
    if (!exists) {
      return `[WARNING] Enforcer script not found: ${enforcerScript} — verify skipped`
    }

    const summary = results
      .map((r) => `${r.name}: ${r.status}`)
      .join("\n")

    const verifierResult = yield* runPythonScriptAdvanced(
      enforcerScript,
      ["--results", summary],
      cwd,
    )
    if (verifierResult.exitCode !== 0) {
      return verifierResult.output || `[ERROR] Enforcer exited with code ${verifierResult.exitCode}`
    }
    return verifierResult.output || ""
  } catch (e) {
    return `[ERROR] Verify failed: ${String(e)}`
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

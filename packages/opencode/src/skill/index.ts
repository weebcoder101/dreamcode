import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Context, Schema, Duration } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { Permission } from "@/permission"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@/config/config"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Glob } from "@opencode-ai/core/util/glob"
import { Discovery } from "./discovery"
import { isRecord } from "@/util/record"
import { resolvePythonCommand, getPythonArgs, writePromptToTmpFile, cleanupTmpFile, BASE_SUBPROCESS_ENV, resolveSkillDirName } from "./python-resolver"

// ─── Script Execution Helpers ────────────────────────────────────
// Used by Skill.Service.require() to auto-execute Python scripts when loading
// skill content. This bridges the gap between the skill tool (which loads
// content) and ChainExecutor (which runs scripts at prompt-build time).

const SCRIPT_OUTPUT_LIMIT = 4096

/** Discover Python scripts in a skill's scripts/ directory */
async function discoverSkillScripts(skillLocation: string): Promise<string[]> {
  const dir = path.dirname(skillLocation)
  try {
    const { Glob: G } = await import("@opencode-ai/core/util/glob")
    return await G.scan("scripts/*.py", { cwd: dir, absolute: true }) as string[]
  } catch {
    return []
  }
}

/** Execute a Python script with a prompt, returning stdout or error */
async function executeSkillScript(
  script: string,
  prompt: string,
  cwd: string,
): Promise<{ output: string; exitCode: number }> {
  const pythonCmd = resolvePythonCommand()
  const versionArgs = getPythonArgs()
  let tmpFile = ""
  try {
    tmpFile = writePromptToTmpFile(prompt, cwd, "sk-")
  } catch (e) {
    return { output: `[ERROR] Failed to create temp file: ${e}`, exitCode: -1 }
  }
  try {
    const proc = Bun.spawn([pythonCmd, ...versionArgs, script, "--prompt-file", tmpFile], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...BASE_SUBPROCESS_ENV, PROJECT_ROOT: cwd },
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const detail = (stderr || stdout || "").slice(0, 500)
      return { output: `[ERROR] Exit code ${exitCode}: ${detail}`, exitCode }
    }
    return { output: (stdout || "").slice(0, SCRIPT_OUTPUT_LIMIT), exitCode: 0 }
  } catch (e) {
    return { output: `[ERROR] ${e}`, exitCode: -1 }
  } finally {
    cleanupTmpFile(tmpFile)
  }
}

/** Sanitize a string for safe inclusion in system prompt XML tags */
function sanitizeForXml(raw: string): string {
  return raw.replace(/]/g, "]\\").replace(/-->/g, "--\\>")
}

const SKILL_EXEC_LOG = path.join(
  process.env.HOME ?? "~",
  ".dreamcode",
  "skill-executions.jsonl",
)

/** Fire-and-forget structured audit log for skill script executions */
function logSkillExecution(entry: {
  skill: string
  script: string
  exitCode: number
  outputLen: number
  timestamp: string
  promptLen: number
}) {
  return Effect.tryPromise({
    try: async () => {
      const { mkdir, appendFile } = await import("fs/promises")
      await mkdir(path.dirname(SKILL_EXEC_LOG), { recursive: true })
      await appendFile(SKILL_EXEC_LOG, JSON.stringify(entry) + "\n")
    },
    catch: () => {}, // Audit log failure is non-fatal
  }).pipe(Effect.catch(() => Effect.void))
}

// ─── End Script Execution Helpers ────────────────────────────────

// Deterministic skill ID from name — stable across restarts for tool-based loading
function skillId(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `skill-${Math.abs(hash).toString(36).padStart(6, "0")}`
}

const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Built-in skill that ships with dreamcode. The model's intuition for what an
// dreamcode.json should look like is often wrong, and dreamcode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch dreamcode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating dreamcode's own configuration: dreamcode.json, dreamcode.jsonc, files under .dreamcode/, or files under ~/.config/dreamcode/. Also use when creating or fixing dreamcode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring dreamcode itself."
const CUSTOMIZE_OPENCODE_SKILL_BODY = SkillPlugin.CustomizeOpencodeContent

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
}) {}

export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Skill.NotFoundError", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Skill "${this.name}" not found. Available skills: ${this.available.join(", ") || "none"}`
  }
}

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly require: (name: string, opts?: { skipAutoExecute?: boolean }) => Effect.Effect<Info, NotFoundError>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
}

const add = Effect.fnUntraced(function* (state: State, match: string, events: EventV2Bridge.Service["Service"]) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = FrontmatterError.isInstance(err) ? err.data.message : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        yield* Effect.logError("failed to load skill", { skill: match, error: err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    yield* Effect.logWarning("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    id: skillId(md.data.name),
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      return Effect.logError(`failed to scan ${opts.scope} skills`, { dir: root, error: error }).pipe(
        Effect.as([] as string[]),
      )
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: FSUtil.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      yield* Effect.logWarning("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  events: EventV2Bridge.Service["Service"],
) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, events), {
    concurrency: "unbounded",
    discard: true,
  })

  yield* Effect.logInfo("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@dreamcode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const fsys = yield* FSUtil.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service

    // First-run skill sync: if global config skills dir is empty, try to copy
    // from the install directory so skills work from any CWD.
    const globalSkillsDir = path.join(global.home, ".config", "dreamcode", "skills")
    const installSkillsDir = path.join(global.home, ".dreamcode", "skills")
    const repoSkillsDir = path.join(global.home, "dreamcode", ".dreamcode", "skills")
    yield* Effect.tryPromise(async (_signal: AbortSignal) => {
      const { stat, mkdir, readdir, cp } = await import("fs/promises")
      const globalEmpty = !(await stat(globalSkillsDir).then((s) => s.isDirectory()).catch(() => false))
      if (!globalEmpty) return
      const source = (await stat(installSkillsDir).then((s) => s.isDirectory()).catch(() => false))
        ? installSkillsDir
        : (await stat(repoSkillsDir).then((s) => s.isDirectory()).catch(() => false))
          ? repoSkillsDir
          : undefined
      if (!source) return
      await mkdir(globalSkillsDir, { recursive: true })
      const entries = await readdir(source)
      for (const entry of entries) {
        const src = path.join(source, entry)
        const dst = path.join(globalSkillsDir, entry)
        await cp(src, dst, { recursive: true }).catch((e) => console.warn("skill: copy to global config failed", e))
      }
    }).pipe(
      Effect.catch((e) => Effect.logWarning("skill sync to global config failed (non-fatal)", { error: String(e) })),
    )

    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(
          config,
          discovery,
          fsys,
          global,
          flags.disableExternalSkills,
          flags.disableClaudeCodeSkills,
          ctx.directory,
          ctx.worktree,
        )
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set() }
        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
          id: skillId(CUSTOMIZE_OPENCODE_SKILL_NAME),
          name: CUSTOMIZE_OPENCODE_SKILL_NAME,
          description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: CUSTOMIZE_OPENCODE_SKILL_BODY,
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), events)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name] ?? s.skills[resolveSkillDirName(name)]
    })

    const require = Effect.fn("Skill.require")(function* (name: string, opts?: { skipAutoExecute?: boolean }) {
      const s = yield* InstanceState.get(state)
      // Try direct lookup first, then alias (e.g. "api-design" → "api")
      const info = s.skills[name] ?? s.skills[resolveSkillDirName(name)]
      if (!info) {
        return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
      }

      // ─── Auto-execute scripts ──────────────────────────────────
      // When a skill has Python scripts, execute them and append results
      // to the content. This bridges the gap between skill loading
      // (SKILL.md text) and ChainExecutor (prompt-build-time execution).
      // Skip when called from ChainExecutor — it handles its own execution.
      if (!opts?.skipAutoExecute && info.location !== "<built-in>") {
        const ctx = yield* InstanceState.contextOrNull
        const cwd = ctx?.directory ?? process.cwd()
        const scripts = yield* Effect.tryPromise({
          try: () => discoverSkillScripts(info.location),
          catch: () => [] as string[],
        })

        if (scripts.length > 0) {
          // Execute the entry point script — prefer run.py, else first found
          const entryScript = scripts.find((s) => path.basename(s) === "run.py") ?? scripts[0]
          const scriptResult = yield* Effect.tryPromise({
            try: () => executeSkillScript(entryScript, "", cwd),
            catch: (e) => ({ output: `[ERROR] Script execution failed: ${e}`, exitCode: -1 }),
          }).pipe(Effect.timeout(Duration.seconds(60)))

          // Structured audit log — fire-and-forget, non-blocking
          yield* logSkillExecution({
            skill: name,
            script: entryScript,
            exitCode: scriptResult.exitCode,
            outputLen: scriptResult.output.length,
            timestamp: new Date().toISOString(),
            promptLen: 0,
          })

          if (scriptResult.exitCode === 0 && scriptResult.output) {
            // Append script result to SKILL.md content
            return {
              ...info,
              content:
                info.content +
                `\n\n<script-result name="${sanitizeForXml(name)}" source="skill-load">\n${sanitizeForXml(scriptResult.output)}\n</script-result>`,
            }
          }
        }
      }

      return info
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    return Service.of({ get, require: require as Interface["require"], all, dirs, available })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    const entries = described.toSorted((a, b) => a.name.localeCompare(b.name)).map((s) => `  - ${s.name} (id: ${s.id})`)
    return [
      "<available_skills>",
      "Use the skill tool to load any skill by name or id. Available skills:",
      ...entries,
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}** (${skill.id}): ${skill.description}`),
  ].join("\n")
}

export const node = LayerNode.make(layer, [
  Discovery.node,
  Config.node,
  EventV2Bridge.node,
  FSUtil.node,
  Global.node,
  RuntimeFlags.node,
])

export * as Skill from "."

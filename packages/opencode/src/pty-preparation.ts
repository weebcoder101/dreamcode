export * as PtyPreparation from "./pty-preparation"

import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { Shell } from "@/shell/shell"
import { Pty } from "@opencode-ai/core/pty"
import path from "node:path"
import { Effect } from "effect"

// Env keys that can hijack library loading or shell startup. These
// keys must NEVER be passed through to a child process spawned on
// behalf of an untrusted PTY request, because the requester could
// otherwise cause the child to load attacker-controlled shared
// libraries (.so / .dylib / .node) or startup scripts.
const FORBIDDEN_ENV_KEYS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "NODE_OPTIONS",
  "NODE_PATH",
  "RUBYOPT",
  "BUNDLE_PATH",
  "GEM_PATH",
  "PERL5LIB",
  "PERL5OPT",
  "CLASSPATH",
  "JAVA_TOOL_OPTIONS",
])

function sanitizeEnv(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_ENV_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

export const prepareCreate = Effect.fn("PtyPreparation.prepareCreate")(function* (input: Pty.CreateInput) {
  const config = yield* Config.Service
  const plugin = yield* Plugin.Service
  const command = input.command || Shell.preferred((yield* config.get()).shell)
  const args = Shell.login(command) ? [...(input.args ?? []), "-l"] : [...(input.args ?? [])]
  // SECURITY: canonicalize cwd against the instance root to prevent
  // a malicious caller from escaping the project directory via "..".
  // Reject the request outright if the resolved path is outside the
  // instance directory. Lexical containment only — symlink resolution
  // happens at the FS layer.
  const instanceDir = (yield* InstanceState.context).directory
  const resolvedCwd = path.resolve(input.cwd || instanceDir)
  if (path.relative(instanceDir, resolvedCwd).startsWith("..")) {
    return yield* Effect.fail(
      new Error(`cwd ${resolvedCwd} is outside the instance directory ${instanceDir}`),
    )
  }
  const cwd = resolvedCwd
  const shell = yield* plugin.trigger("shell.env", { cwd }, { env: {} })
  const env = {
    ...process.env,
    ...sanitizeEnv(input.env),
    ...sanitizeEnv(shell.env),
    TERM: "xterm-256color",
    OPENCODE_TERMINAL: "1",
  } as Record<string, string>
  if (process.platform === "win32") {
    env.LC_ALL = "C.UTF-8"
    env.LC_CTYPE = "C.UTF-8"
    env.LANG = "C.UTF-8"
  }
  return { command, args, cwd, title: input.title, env }
})

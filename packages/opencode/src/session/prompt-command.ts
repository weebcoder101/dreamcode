import { Effect } from "effect"
import { CommandInput, bashRegex, argsRegex, placeholderRegex, quoteTrimRegex } from "./prompt-schemas"
import { Command } from "../command"
import { Session } from "./session"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"
import { Provider } from "@/provider/provider"
import { dieSyncError } from "@/effect/sync-error"
import { NamedError } from "@opencode-ai/core/util/error"
import { fileURLToPath } from "url"
import type { SessionID } from "./schema"

export const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput & {
  sessions: any
  agents: any
  commands: Command.Interface
  config: Config.Interface
  plugin: any
  events: any
  provider: Provider.Interface
  getModel: any
  currentModel: (sessionID: SessionID) => any
  resolvePromptParts: (template: string) => any
  prompt: any
}) {
  const { sessions, agents, commands, config, plugin, events, provider, getModel, currentModel, resolvePromptParts, prompt } = input
  yield* Effect.logInfo("command", {
    "session.id": input.sessionID,
    command: input.command,
    agent: input.agent,
  })
  const cmd = yield* commands.get(input.command)
  if (!cmd) {
    const available = (yield* commands.list()).map((c: any) => c.name)
    const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
    yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
    throw error
  }
  const agentName = cmd.agent ?? input.agent
  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg: string) => arg.replace(quoteTrimRegex, ""))
  const templateCommand = yield* Effect.promise(async () => cmd.template)
  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }
  const withArgs = templateCommand.replaceAll(placeholderRegex, (_: string, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = template + "\n\n" + input.arguments
  }
  const shellMatches = ConfigMarkdown.shell(template)
  if (shellMatches.length > 0) {
    const cfg = yield* config.get()
    const sh = Shell.preferred(cfg.shell)
    const results = yield* Effect.promise(() =>
      Promise.all(
        shellMatches.map(async ([, cmd]: any) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
      ),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()
  const taskModel = yield* Effect.gen(function* () {
    if (cmd.model) return Provider.parseModel(cmd.model)
    if (cmd.agent) {
      const cmdAgent = yield* agents.get(cmd.agent)
      if (cmdAgent?.model) return cmdAgent.model
    }
    if (input.model) return Provider.parseModel(input.model)
    return yield* currentModel(input.sessionID)
  })
  yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)
  const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
  if (!agent) {
    const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
    throw error
  }
  const templateParts = yield* resolvePromptParts(template)
  const inputFiles = new Set(
    input.parts?.filter((part: any) => new URL(part.url).protocol === "file:").map((part: any) => fileURLToPath(part.url)),
  )
  const uniqueTemplateParts = templateParts.filter(
    (part: any) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
  )
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: cmd.description ?? "",
          command: input.command,
          model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
          prompt: templateParts.find((y: any) => y.type === "text")?.text ?? "",
        },
      ]
    : [...uniqueTemplateParts, ...(input.parts ?? [])]
  const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
  const userModel = isSubtask
    ? input.model
      ? Provider.parseModel(input.model)
      : yield* currentModel(input.sessionID)
    : taskModel
  yield* plugin.trigger(
    "command.execute.before",
    { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
    { parts },
  )
  const result = yield* prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })
  yield* dieSyncError(events.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  }))
  return result
})

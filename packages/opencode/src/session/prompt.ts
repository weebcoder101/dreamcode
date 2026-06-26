import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { SensorGate, evaluateSpawnNecessity, type Persona, type SensorGateResult } from "@/skill/sensor-gate"
import { ChainExecutor } from "@/skill/chain-executor"
import { debugLog } from "@/skill/python-resolver"
import * as PersonaTracker from "./persona-tracker"
import { ContextCompressor } from "./context-compressor"
import { PiecesLTM } from "@/pieces-ltm"
import { extractSubagentContext, buildSubagentContextPrompt } from "./subagent-context"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, Prompt, Source } from "@opencode-ai/core/session/prompt"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function sanitizeForSystemPrompt(text: string): string {
  // Escape HTML/XML metacharacters to prevent prompt injection via tag injection.
  // Order matters: & first to avoid double-escaping.
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sensorGate = yield* SensorGate.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const skillService = yield* Skill.Service
    const chainExecutor = yield* ChainExecutor.Service
    const piecesLTM = yield* PiecesLTM.PiecesLTM

    const ops = Effect.fn("SessionPrompt.ops")(function* (opts?: { disableTaskTool?: boolean }) {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
        disableTaskTool: opts?.disableTaskTool ?? false,
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      sensorGateFiredMap.delete(sessionID)
      personaRoundMap.delete(sessionID)
      spawnHistory.delete(sessionID)
      yield* state.cancel(sessionID)
    })

    const sensorGateFiredMap = new Map<SessionID, boolean>()
    const personaRoundMap = new Map<SessionID, number>()
    const MAX_PERSONA_ROUNDS = 3

    // ─── Rolling-Window Rate Limiter ─────────────────────────────────
    // Max 5 persona spawns per 5-minute window per session.
    // Prevents compute cost explosion from rapid-fire specialist requests.
    const RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
    const RATE_MAX_SPAWNS = 5
    const spawnHistory = new Map<SessionID, Array<{ timestamp: number; count: number }>>()

    function checkRateLimit(sessionID: SessionID): { allowed: boolean; remaining: number; resetMs: number } {
      const now = Date.now()
      const history = spawnHistory.get(sessionID) ?? []
      const valid = history.filter((e) => now - e.timestamp < RATE_WINDOW_MS)
      spawnHistory.set(sessionID, valid)
      const totalSpawns = valid.reduce((sum, e) => sum + e.count, 0)
      if (totalSpawns >= RATE_MAX_SPAWNS) {
        const oldestInWindow = valid[0]
        const resetMs = oldestInWindow ? RATE_WINDOW_MS - (now - oldestInWindow.timestamp) : RATE_WINDOW_MS
        return { allowed: false, remaining: 0, resetMs }
      }
      return { allowed: true, remaining: RATE_MAX_SPAWNS - totalSpawns, resetMs: RATE_WINDOW_MS }
    }

    function recordSpawn(sessionID: SessionID, count: number) {
      const history = spawnHistory.get(sessionID) ?? []
      history.push({ timestamp: Date.now(), count })
      spawnHistory.set(sessionID, history)
    }

    function parseExplicitSpawnCount(text: string): number {
      const match = text.match(/(?:spawn|use|run|deploy)\s+(\d+)\s+(?:agent|subagent|specialist|persona)/i)
      return match ? Math.min(parseInt(match[1], 10), RATE_MAX_SPAWNS) : 0
    }

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()

      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Shell.Started, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: DateTime.makeUnsafe(started),
                callID: part.callID,
                command: input.command,
              })
            }
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Shell.Ended, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const current = yield* db
        .select({ agent: SessionTable.agent, model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      if (current?.agent !== info.agent) {
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Prompted, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          delivery: "steer",
          prompt: new Prompt({
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
          }),
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Synthetic, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const SELF_CHECK = `# Self-Check Protocol

Before every response, verify your reasoning:
1. Does the plan directly address the user's request?
2. What assumptions are you making that could be wrong?
3. Are you passing real values, not placeholders or literals?
4. What is the most likely failure mode for your approach?`

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let synthesisText: string | undefined
        let prevUserMessageID: string | undefined
        let titleGenerated = false
        let sensorGateFired = sensorGateFiredMap.get(sessionID) ?? false
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        while (true) {
          synthesisText = undefined
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          if (prevUserMessageID !== lastUser.id) {
            step = 0
            prevUserMessageID = lastUser.id
          }

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                "session.id": sessionID,
                messageID: lastAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }
            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
            break
          }

          step++
          if (step === 1 && !titleGenerated) {
            titleGenerated = true
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))
          }

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }

          // /compact command — bypass sensor gate, trigger compaction directly
          if (!session.parentID) {
            const userText = msgs
              .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
              .flatMap((m) => m.parts)
              .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
              .map((p) => p.text)
              .join("\n")
            if (userText.trim().startsWith("/compact")) {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: false,
              })
              continue
            }
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }

          // Subagents should NOT trigger auto-compaction — they do focused work
          // and compaction during their execution is costly and disruptive.
          if (
            agent.mode !== "subagent" &&
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
          )

          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
            )

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const [skills, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            const system = [...env, ...instructions, ...(skills ? [skills] : []), SELF_CHECK]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)

            // ─── Sensor Gate: Native Dream Mode ─────────────────────────
            // Runs classification + skill chain selection on every user message.
            // Only in root sessions — subagents must NOT re-enter persona spawning.
            // Also skip when the agent itself is a subagent (mode === "subagent").
            // Skip after synthesis — synthesis should NOT auto-spawn subagents.
            if (step === 1 && !session.parentID) {
              const userText = msgs
                .filter((m) => m.info.role === "user" && m.info.id === lastUser.id)
                .flatMap((m) => m.parts)
                .filter((p): p is typeof p & { type: "text" } => p.type === "text" && !p.ignored)
                .map((p) => p.text)
                .join("\n")

              // Detect synthesis response — skip auto-spawn after synthesis
              const lastUserMsg = msgs.findLast(
                (m) => m.info.role === "user" && m.info.id === lastUser.id,
              )
              const isSynthesis = lastUserMsg?.parts.some(
                (p) => p.type === "text" && "synthetic" in p && p.synthetic && p.text.startsWith("<synthesis-request>"),
              ) ?? false

              if (userText.trim() && !isSynthesis) {
                const gateResult = yield* sensorGate.classify(userText).pipe(
                  Effect.catchCause((cause) =>
                    Effect.as(Effect.logError("Sensor gate unavailable", { cause }), null),
                  ),
                )
                const explicitSpawnCount = parseExplicitSpawnCount(userText)
                if (gateResult && !gateResult.is_social_greeting) {
                  const isLowConfidence = gateResult.confidence < 0.7

                  // Compute spawn necessity early so we can gate chain executor too
                  const spawnEval = explicitSpawnCount > 0
                    ? { shouldSpawn: true, reason: `User explicitly requested ${explicitSpawnCount} specialist agents`, suggestedCount: explicitSpawnCount }
                    : evaluateSpawnNecessity(gateResult, userText)

                  // When the sensor gate's Python script failed (empty domain_tags, empty chain)
                  // but the TypeScript fallback generated personas, override the necessity veto.
                  // Without this, evaluateSpawnNecessity scores 0 and persona spawning is skipped,
                  // causing the LLM to spawn generic subagents instead of named personas (Windows).
                  const isFallbackPersonas = gateResult.domain_tags.length === 0 && gateResult.personas.length > 0
                  if (isFallbackPersonas && !spawnEval.shouldSpawn) {
                    spawnEval.shouldSpawn = true
                    spawnEval.suggestedCount = Math.max(spawnEval.suggestedCount, gateResult.personas.length)
                    spawnEval.reason = "Fallback personas generated after sensor gate failure"
                  }

                  const sensorBlock = [
                    "<sensor-gate>",
                    `Intent: ${sanitizeForSystemPrompt(gateResult.intent)}`,
                    `Mode: ${sanitizeForSystemPrompt(gateResult.mode)}`,
                    `Confidence: ${gateResult.confidence}`,
                    `Primary Skill: ${sanitizeForSystemPrompt(gateResult.primary_skill)}`,
                    `Support Skills: ${sanitizeForSystemPrompt(gateResult.support_skills.join(", "))}`,
                    `Chain: ${sanitizeForSystemPrompt(gateResult.chain.join(" → "))}`,
                    `Guardian: ${sanitizeForSystemPrompt(gateResult.guardian_decision)} (${sanitizeForSystemPrompt(gateResult.guardian_risk)})`,
                    "",
                    sanitizeForSystemPrompt(gateResult.skill_plan),
                  ]

                  // Add neuro analysis if available
                  if (gateResult.neuro_result) {
                    const safeNeuro = typeof gateResult.neuro_result === "string"
                      ? gateResult.neuro_result.slice(0, 10_000)
                      : JSON.stringify(gateResult.neuro_result).slice(0, 50_000)
                    sensorBlock.push("", "<neuro-analysis>", sanitizeForSystemPrompt(safeNeuro), "</neuro-analysis>")
                  }

                  sensorBlock.push("</sensor-gate>")
                  system.push(sensorBlock.join("\n"))

                  // Skill manifest: UUIDs + dependency graph, not full content
                  // Agent loads skills via the `skill` tool at runtime using UUIDs
                  const manifestSkills: string[] = []
                  for (const skillName of gateResult.chain) {
                    const skillInfo = yield* skillService.require(skillName).pipe(Effect.option)
                    if (skillInfo._tag === "Some") {
                      manifestSkills.push(`  - ${skillName} (id: ${skillInfo.value.id})`)
                    } else {
                      manifestSkills.push(`  - ${skillName} (id: unknown — not found)`)
                    }
                  }
                  const chainSkillNames = gateResult.chain.join(", ")
                  system.push(
                    `\n<skill-chain>` +
                    `\nChain skills for this task: ${chainSkillNames}` +
                    `\n${manifestSkills.join("\n")}` +
                    `\n</skill-chain>` +
                    `\n<chain-mandatory>` +
                    `\nCRITICAL: You MUST load EACH skill from the chain above using the \`skill\` tool BEFORE proceeding with your analysis.` +
                    `\nYour FIRST action must be: call \`skill\` for each skill in the chain. Only after ALL chain skills are loaded may you begin analysis.` +
                    `\nFailure to load chain skills will result in incomplete analysis and is forbidden.` +
                    `\n</chain-mandatory>`,
                  )

                  // ─── ChainExecutor: Execute skills programmatically ──
                  // After loading skill content, run the chain executor
                  // to produce execution results for each skill.
                  // Runs whenever a chain is selected — even simple tasks benefit from skill scripts.
                  if (gateResult.chain.length > 0) {
                    const chainResults = yield* chainExecutor.execute(gateResult.chain, userText).pipe(
                      Effect.catch((e) => {
                        console.warn("[chain-executor] execute() failed:", e)
                        return Effect.succeed([])
                      }),
                    )
                    for (const result of chainResults) {
                      if (result.status === "ok" && result.output) {
                        system.push(`\n<skill-result name="${result.name}">\n${result.output.slice(0, 5000)}\n</skill-result>`)
                      } else if (result.status === "not_found") {
                        system.push(`\n<skill-missing name="${result.name}"/>`)
                      } else {
                        system.push(`\n<skill-result name="${result.name}" status="error">\n${result.output.slice(0, 2000)}\n</skill-result>`)
                      }
                    }

                    // Phase 5: Wire orphaned Python scripts — run for any task with 2+ skills
                    if (gateResult.complexity === "high" || gateResult.chain.length > 1) {
                      const pipelineResults = yield* chainExecutor.runFullPipeline(gateResult.chain, userText).pipe(
                        Effect.catch((e) => {
                          console.warn("[chain-executor] runFullPipeline() failed:", e)
                          return Effect.succeed([])
                        }),
                      )
                      for (const result of pipelineResults) {
                        if (result.status === "ok" && result.output) {
                          system.push(`\n<chain-executor-result name="${result.name}">\n${result.output.slice(0, 5000)}\n</chain-executor-result>`)
                        }
                      }

                      const verifyResult = yield* chainExecutor.verify(chainResults).pipe(
                        Effect.catch((e) => {
                          console.warn("[chain-executor] verify() failed:", e)
                          return Effect.succeed("")
                        }),
                      )
                      if (verifyResult) {
                        system.push(`\n<chain-verification>\n${verifyResult.slice(0, 2000)}\n</chain-verification>`)
                      }
                    }

                    // ─── Chain-Gap Detection ──────────────────────────
                    // Hard enforcement: warn if any chain skill wasn't executed
                    const missingSkills = gateResult.chain.filter(
                      (name) => !chainResults.some((r) => r.name === name && r.status === "ok"),
                    )
                    // Mandated skills that MUST execute when in DREAM_INNOVATION mode
                    const MANDATED_SKILLS = new Set(["breakthrough-overdrive-innovation"])
                    const missingMandated = missingSkills.filter((s) => MANDATED_SKILLS.has(s))

                    if (missingMandated.length > 0) {
                      // Force re-execute mandated skills that were skipped
                      debugLog("[prompt] Re-executing mandated skills:", missingMandated)
                      const reExecuteResult = yield* chainExecutor.execute(missingMandated, userText).pipe(
                        Effect.catch(() => Effect.succeed([] as Array<{ name: string; status: string }>)),
                      )
                      chainResults.push(...reExecuteResult)
                      // Update missing list after re-execution
                      const stillMissing = gateResult.chain.filter(
                        (name) => !chainResults.some((r) => r.name === name && r.status === "ok"),
                      )
                      if (stillMissing.length > 0) {
                        system.push(
                          `\n<chain-gap>WARNING: These skills in the sensor gate chain were NOT executed: ${stillMissing.join(", ")}. ` +
                          `You MUST ensure each skill in the chain is loaded and its instructions followed before proceeding.` +
                          `\nSkipped chain steps degrade the quality of the response.</chain-gap>`,
                        )
                      }
                    } else if (missingSkills.length > 0) {
                      system.push(
                        `\n<chain-gap>WARNING: These skills in the sensor gate chain were NOT executed: ${missingSkills.join(", ")}. ` +
                        `You MUST ensure each skill in the chain is loaded and its instructions followed before proceeding.` +
                        `\nSkipped chain steps degrade the quality of the response.</chain-gap>`,
                      )
                    }

                    // ─── PiecesLTM Auto-Persist ──────────────────────
                    // Programmatically persist every chain execution to LTM.
                    yield* piecesLTM.persist({
                      chainName: gateResult.chain.join(" → "),
                      taskDescription: gateResult.intent,
                      outcome: missingSkills.length === 0 ? "success" : "failed",
                      memoryType: gateResult.mode === "DREAM_INNOVATION" ? "breakthrough" : "learn",
                      metrics: {
                        chainLength: gateResult.chain.length,
                        mode: gateResult.mode,
                        confidence: gateResult.confidence,
                        skillsExecuted: chainResults.filter((r) => r.status === "ok").length,
                        skillsMissing: missingSkills.length,
                      },
                      project: ctx.directory,
                    }).pipe(Effect.catch(() => Effect.void))

                    // ─── Self-Evolution: Auto-log to run_log.jsonl ──
                    // Write structured learning signals after every chain execution.
                    yield* Effect.tryPromise({
                      try: () => {
                        const evolutionDir = path.join(ctx.directory, "evolution")
                        const logLine = JSON.stringify({
                          timestamp: new Date().toISOString(),
                          type: "chain_execution",
                          prompt_excerpt: userText.slice(0, 200),
                          chain: gateResult.chain,
                          chain_length: gateResult.chain.length,
                          mode: gateResult.mode,
                          outcome: missingSkills.length === 0 ? "success" : "partial",
                          skills_executed: chainResults.filter((r) => r.status === "ok").map((r) => r.name),
                          skills_missing: missingSkills,
                          confidence: gateResult.confidence,
                          neuro_available: Boolean(gateResult.neuro_result),
                        }) + "\n"
                        const dir = Bun.file(evolutionDir)
                        // ensure evolution dir exists by writing to a file inside it
                        return Bun.write(
                          path.join(evolutionDir, "run_log.jsonl"),
                          logLine,
                          { createPath: true, append: true },
                        )
                      },
                      catch: () => {},
                    })
                  }

                  // ─── Persona System Injection ─────────────────────────
                  // Also enter when user explicitly requests N agents, or when spawn
                  // necessity evaluation determines specialists are needed, even
                  // without sensor gate personas.
                  if (explicitSpawnCount > 0 || gateResult.personas.length > 0 || spawnEval.shouldSpawn) {
                    // ─── Spawn Necessity Check (reuses early-computed spawnEval) ─
                    if (!spawnEval.shouldSpawn) {
                      // Agent handles directly — inject sensor gate info but skip persona spawning
                      system.push(`\n<spawn-decision>SPAWN SKIPPED: ${spawnEval.reason}. Handle this task directly using the skill plan above.</spawn-decision>`)
                    } else if (!checkRateLimit(sessionID).allowed) {
                      // Rate limit hit — skip spawning, inject warning
                      const rateCheck = checkRateLimit(sessionID)
                      system.push(`\n<rate-limit>Subagent rate limit reached (${RATE_MAX_SPAWNS} per 5min). ${Math.ceil(rateCheck.resetMs / 1000)}s until reset. Handle the task directly using the skill plan.</rate-limit>`)
                    } else {
                    // ─── Proceed with spawning ──────────────────────────
                    sensorGateFired = true
                    sensorGateFiredMap.set(sessionID, true)
                    const currentRound = personaRoundMap.get(sessionID) ?? 0
                    personaRoundMap.set(sessionID, currentRound + 1)

                    // Rate limit: truncate persona count to remaining budget
                    const rateCheck = checkRateLimit(sessionID)
                    const hasEmptyPersonas = gateResult.personas.length === 0
                    const needSynthetic = hasEmptyPersonas && (explicitSpawnCount > 0 || spawnEval.shouldSpawn)
                    const syntheticCount = needSynthetic
                      ? (explicitSpawnCount > 0 ? explicitSpawnCount : spawnEval.suggestedCount)
                      : 0
                    const personaTeam = needSynthetic
                      ? Array.from({ length: Math.min(syntheticCount, rateCheck.remaining) }, (_, i): Persona => ({
                          name: `Specialist ${i + 1}`,
                          role: "Agent",
                          focus: "Analyzing the user's request",
                          skills: [],
                          task: "Analyze the user's request from your specialist perspective",
                          goals: [],
                          synthesisGuide: "",
                        }))
                      : gateResult.personas.slice(0, Math.min(spawnEval.suggestedCount, rateCheck.remaining))
                    recordSpawn(sessionID, personaTeam.length)

                    const personaLines = [
                      "<persona-system>",
                      `You are the ARCHITECT. You have spawned ${personaTeam.length} specialist agent${personaTeam.length > 1 ? "s" : ""}:`,
                      "",
                    ]
                    personaTeam.forEach((p, i) => {
                      personaLines.push(`${i + 1}. "${p.name}" (${p.role})`)
                      const taskDisplay = p.task
                        ? (p.task.length > 120 ? p.task.slice(0, 117) + "..." : p.task)
                        : `Analyzing ${p.focus}`
                      personaLines.push(`   Task: ${taskDisplay}`)
                      if (p.goals?.length) {
                        personaLines.push(`   Goals: ${p.goals.join("; ")}`)
                      }
                      personaLines.push("")
                    })
                    personaLines.push(`This is ROUND ${currentRound + 1} of specialist analysis.`)
                    personaLines.push("Each specialist provides findings asynchronously.")
                    personaLines.push("Their results will arrive as user messages. Wait for them before acting.")
                    personaLines.push("")
                    if (currentRound + 1 >= MAX_PERSONA_ROUNDS) {
                      personaLines.push("CRITICAL: This is your FINAL round of specialist analysis.")
                      personaLines.push("After these results arrive, you MUST implement directly.")
                      personaLines.push("The task tool is DISABLED after this round. No more subagents.")
                      personaLines.push("Focus all your effort on implementing the solution now.")
                    } else if (isLowConfidence) {
                      personaLines.push("MULTI-ROUND MODE (low confidence task):")
                      personaLines.push("This task requires thorough multi-round specialist analysis.")
                      personaLines.push("When specialist results arrive, synthesize and assess coverage.")
                      personaLines.push("If findings are incomplete or ambiguous, spawn additional specialists to fill gaps.")
                      personaLines.push(`You have up to ${MAX_PERSONA_ROUNDS} rounds. Use them wisely.`)
                      personaLines.push("After reaching the round limit or achieving full coverage, IMPLEMENT the solution.")
                      personaLines.push("")
                      personaLines.push("LOOP SAFETY: Do not re-spawn specialists for the same analysis area.")
                      personaLines.push("Each new round must target a DIFFERENT gap. No duplicate work.")
                    } else {
                      personaLines.push("EFFICIENCY MODE (high confidence task):")
                      personaLines.push("You should complete analysis in ONE round if possible.")
                      personaLines.push("Only spawn additional specialists if you find CRITICAL gaps in coverage.")
                      personaLines.push("")
                      personaLines.push("SYNTHESIS & DECISION LOOP:")
                      personaLines.push("1. When all specialist results arrive, IMMEDIATELY synthesize findings")
                      personaLines.push("2. Check: Do findings cover ALL aspects of the user's request?")
                      personaLines.push("3. If YES (findings are complete): IMPLEMENT NOW. Do not spawn more specialists.")
                      personaLines.push("4. If NO (critical gaps exist): Spawn ONLY the missing specialist(s)")
                      personaLines.push("5. After any gap-filling round, you MUST implement. No further spawning.")
                      personaLines.push("")
                      personaLines.push("KEY: Each round of spawning costs time and money. Be efficient.")
                      personaLines.push("Most tasks should complete in 1 round. Use round 2 only for critical gaps.")
                    }
                    personaLines.push("</persona-system>")
                    // Rate limit awareness — tell agent the budget so it self-regulates
                    const rateNow = checkRateLimit(sessionID)
                    personaLines.push(`<rate-budget>${rateNow.remaining} of ${RATE_MAX_SPAWNS} specialist spawns remaining in this 5-minute window. Think before spawning: can you solve this directly?</rate-budget>`)
                    system.push(personaLines.join("\n"))

                    // ─── ENFORCEMENT: Spawn persona subagents ────────────
                    const { task: taskTool } = yield* registry.named()
                    const subtaskOps = yield* ops({ disableTaskTool: true })
                    const generalAgent = yield* agents.get("general")
                    if (generalAgent) {
                      const tracker = PersonaTracker.create(sessionID, personaTeam.length)

                      const personaAssistantMsg: SessionV1.Assistant = yield* sessions.updateMessage({
                        id: MessageID.ascending(),
                        role: "assistant",
                        parentID: lastUser.id,
                        sessionID,
                        mode: "general",
                        agent: "general",
                        variant: lastUser.model.variant,
                        path: { cwd: ctx.directory, root: ctx.worktree },
                        cost: 0,
                        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                        providerID: model.providerID,
                        modelID: model.id,
                        time: { created: Date.now() },
                      })

                      const personaParts: SessionV1.ToolPart[] = yield* Effect.all(
                        personaTeam.map((persona) =>
                          sessions.updatePart({
                            id: PartID.ascending(),
                            messageID: personaAssistantMsg.id,
                            sessionID,
                            type: "tool",
                            callID: ulid(),
                            tool: TaskTool.id,
                            state: {
                              status: "running",
                              input: {
                                prompt: persona.focus,
                                description: `persona:${persona.name}`,
                                subagent_type: "general",
                              },
                              time: { start: Date.now() },
                            },
                          } as SessionV1.ToolPart),
                        ),
                      )

                      // Extract smart subagent context once for all personas
                      // instead of passing the full 200K+ token msgs array.
                      const subagentCtx = extractSubagentContext(msgs)

                      // Pre-compute once — shared across all concurrent persona calls
                      const contextBlock = buildSubagentContextPrompt(subagentCtx)

                      // Pre-sanitize gateResult values once (avoids N× redundant regex runs)
                      const safeMode = sanitizeForSystemPrompt(gateResult.mode)
                      const safeComplexity = sanitizeForSystemPrompt(gateResult.complexity)
                      const safeChain = sanitizeForSystemPrompt(gateResult.chain.join(" → "))

                      yield* Effect.forEach(
                        personaTeam,
                        Effect.fnUntraced(function* (persona, i) {
                          const part = personaParts[i]
                          // Static string — identical across ALL concurrent persona calls
                          // so KV-cache prefix is shared. Persona-specific details go
                          // in the DYNAMIC section at the end of the prompt.
                          const otherContext = personaTeam.length > 1
                            ? "\nOther specialist agents are analyzing related aspects of this task from their own focus areas.\nDo NOT duplicate work. Cover ONLY your assigned focus area.\n"
                            : ""

                          const goalsBlock = persona.goals?.length
                            ? ["", "## Goals", ...persona.goals.map((g) => `- ${g}`)].join("\n")
                            : ""

                          // Cache-optimized prompt ordering: STATIC sections first so all
                          // concurrent persona calls share the same KV-cache prefix.
                          // Persona-specific identity is pushed to the end.
                          const personaPrompt = [
                            // === STATIC SECTIONS (identical for all concurrent personas) ===
                            "## Output Requirements",
                            "Provide your findings as a STRUCTURED ANALYSIS with:",
                            "1. **Summary**: One paragraph overview of your findings",
                            "2. **Key Issues**: Bullet list of specific problems found (with file:line references)",
                            "3. **Recommendations**: Actionable fixes with code snippets where possible",
                            "4. **Confidence**: Rate your confidence (High/Medium/Low) for each finding",
                            "",
                            "Be CONCISE. Focus on ACTIONABLE items only.",
                            "Do not repeat findings from other specialists.",
                            "Do not attempt to produce a final answer — produce a focused specialist report.",
                            "",
                            "## Your Guiding Steps",
                            "1. Focus specifically on your assigned focus area",
                            "2. Identify issues in your domain with file:line references",
                            "3. Provide actionable recommendations with code snippets",
                            "4. Flag any blockers that would prevent implementation",
                            "",
                            // Static: other specialists info (same for all calls)
                            otherContext,
                            "",
                            `## Synthesis Guide`,
                            persona.synthesisGuide || `When synthesizing, include your findings on your focus area.`,
                            "",
                            // === SEMI-STATIC: context block (same for all personas in same turn) ===
                            contextBlock,
                            "",
                            // Skill chain context — pass gateResult info so subagent knows the skill chain
                            ...(gateResult ? [
                              "## Skill Chain Context",
                              `Mode: ${safeMode}`,
                              `Complexity: ${safeComplexity}`,
                              `Chain: ${safeChain}`,
                              `Use the \`skill\` tool to load any skill by name or UUID from the chain as needed.`,
                              "",
                            ] : []),
                            "## User Prompt",
                            sanitizeForSystemPrompt(userText.trim()),
                            "",
                            // === DYNAMIC SECTIONS (diverges per persona) at the very end ===
                            `## Your Identity`,
                            `You are "${persona.name}" — ${persona.role}.`,
                            `Your focus area: ${persona.focus}.`,
                            ...(personaTeam.length > 1
                              ? [
                                  "",
                                  "## Other Specialists",
                                  ...personaTeam
                                    .filter((_, j) => j !== i)
                                    .map((o) => `- "${o.name}" (${o.role}) — focuses on ${o.focus}`),
                                  "",
                                ]
                              : []),
                            `## Task`,
                            persona.task || `Analyze the following task from your ${persona.role} perspective.`,
                            goalsBlock,
                            ...(persona.neuroResult ? [
                              "",
                              "## NEURO Analysis",
                              sanitizeForSystemPrompt(persona.neuroResult.slice(0, 10_000)),
                              "Use this analysis to inform your findings.",
                            ] : []),
                          ].join("\n")

                           const markComplete = (status: "completed" | "error", output: string, extraMeta?: Record<string, any>) =>
                             Effect.gen(function* () {
                               yield* tracker.complete(persona.name, persona.role, output, status, {
                                 task: persona.task,
                                 goals: persona.goals,
                                 synthesisGuide: persona.synthesisGuide,
                               })
                                const st = part.state as { status: string; time?: { start: number }; input: Record<string, any>; metadata?: Record<string, any> }
                                yield* sessions.updatePart({
                                  ...part,
                                  type: "tool",
                                  state: status === "completed"
                                    ? { ...st, status: "completed" as const, output, title: persona.name, metadata: { ...st.metadata, ...extraMeta, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } }
                                    : { ...st, status: "error" as const, error: output, metadata: { ...st.metadata, ...extraMeta, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } },
                               } as SessionV1.ToolPart)
                             }).pipe(Effect.catchCause((cause) => Effect.logWarning("markComplete failed", { cause })))

                            yield* Effect.all([
                              taskTool
                                .execute(
                                  {
                                    prompt: personaPrompt,
                                    description: `persona:${persona.name}`,
                                    subagent_type: "general",
                                  },
                                  {
                                    agent: "general",
                                    sessionID,
                                    messageID: personaAssistantMsg.id,
                                    messages: subagentCtx.recentMessages,
                                    abort: new AbortController().signal,
                                    callID: (part as SessionV1.ToolPart).callID,
                                    extra: { bypassAgentCheck: true, promptOps: subtaskOps },
                                    metadata: (meta) => Effect.gen(function* () {
                                      yield* sessions.updatePart({
                                        ...part,
                                        type: "tool",
                                        state: {
                                          ...part.state,
                                          title: meta.title ?? (part.state as any).title,
                                          metadata: { ...(part.state as any).metadata, ...meta.metadata },
                                        },
                                      } as SessionV1.ToolPart)
                                    }).pipe(Effect.catchCause((cause) => Effect.void)),
                                    ask: () => Effect.succeed({ status: "allow" as const }),
                                  },
                                )
                                .pipe(
                                  Effect.tap((result) => markComplete("completed", result.output, result.metadata)),
                                  Effect.catchCause((cause) =>
                                    markComplete("error", `persona died: ${Cause.pretty(cause)}`),
                                  ),
                                ),
                            ])
                        }),
                        { concurrency: 5 },
                      )

                      const personaResults = yield* tracker.getAll()
                      synthesisText = PersonaTracker.buildSynthesisPrompt(personaResults)
                      yield* Effect.promise(() =>
                        PersonaTracker.injectSynthesis(sessionID, personaResults, sessions, model.providerID, model.id)
                      ).pipe(Effect.catchCause((cause) => Effect.void))
                    }
                    // ─── End Enforcement ─────────────────────────────────
                    } // close else (spawn allowed)
                  }
                  // ─── End Persona System ───────────────────────────────

                  // ─── Dream Enforcement (outside spawn condition) ─────
                  // Always inject when DREAM_INNOVATION mode, regardless of
                  // whether spawn was needed — dream mode is about thinking,
                  // not just subagent spawning.
                  if (gateResult.mode === "DREAM_INNOVATION") {
                    system.push(
                      `\n<dream-enforcement>` +
                      `\nYou are operating in DREAM_INNOVATION mode. You MUST:` +
                      `\n1. Ground your thinking — state what you know and what the constraints are` +
                      `\n2. Dream — produce latent insights, non-obvious connections, TRIZ contradictions` +
                      `\n3. Multi-perspective — view from security, performance, UX, cost, architecture` +
                      `\n4. Propose — offer exactly 3 innovations with hypothesis, experiment, failure modes, risk/reward` +
                      `\n5. Build — pick and implement ONE proposal` +
                      `\nDo not skip these steps. This is the default thinking mode.` +
                      `\n</dream-enforcement>`,
                    )
                  }

                } else if (explicitSpawnCount > 0) {
                  // Sensor gate was null (crashed or unavailable) but user explicitly
                  // requested spawn — create synthetic personas and spawn them directly.
                  sensorGateFired = true
                  sensorGateFiredMap.set(sessionID, true)
                  const currentRound = personaRoundMap.get(sessionID) ?? 0
                  personaRoundMap.set(sessionID, currentRound + 1)

                  const rateCheck = checkRateLimit(sessionID)
                  if (rateCheck.allowed) {
                    const spawnCount = Math.min(explicitSpawnCount, rateCheck.remaining)
                    recordSpawn(sessionID, spawnCount)

                    // Create synthetic personas for the explicit spawn request
                    const syntheticPersonas: Persona[] = Array.from({ length: spawnCount }, (_, i): Persona => ({
                      name: `Specialist ${i + 1}`,
                      role: "Analysis Specialist",
                      focus: "Analyzing the user's request from a specialist perspective",
                      skills: [],
                      task: `Analyze the user's request from your specialist perspective: ${userText.slice(0, 200)}`,
                      goals: [
                        "Identify issues and opportunities in the codebase",
                        "Provide specific, actionable findings with file references",
                        "Flag any blocking issues or high-priority concerns",
                      ],
                      synthesisGuide: `Include Specialist ${i + 1}'s findings in the synthesis.`,
                    }))

                    const personaTeam = syntheticPersonas.slice(0, spawnCount)

                    const personaLines = [
                      "<persona-system>",
                      `You are the ARCHITECT. You have spawned ${personaTeam.length} specialist agent${personaTeam.length > 1 ? "s" : ""}:`,
                      "",
                    ]
                    personaTeam.forEach((p, i) => {
                      personaLines.push(`${i + 1}. "${p.name}" (${p.role})`)
                      const taskDisplay = p.task.length > 120 ? p.task.slice(0, 117) + "..." : p.task
                      personaLines.push(`   Task: ${taskDisplay}`)
                      personaLines.push("")
                    })
                    personaLines.push(`This is ROUND ${currentRound + 1} of specialist analysis.`)
                    personaLines.push("Each specialist provides findings asynchronously.")
                    personaLines.push("Their results will arrive as user messages. Wait for them before acting.")
                    personaLines.push("</persona-system>")
                    const rateNow = checkRateLimit(sessionID)
                    personaLines.push(`<rate-budget>${rateNow.remaining} of ${RATE_MAX_SPAWNS} specialist spawns remaining in this 5-minute window.</rate-budget>`)
                    system.push(personaLines.join("\n"))

                    // ─── ENFORCEMENT: Spawn persona subagents ────────────
                    const { task: taskTool } = yield* registry.named()
                    const subtaskOps = yield* ops({ disableTaskTool: true })
                    const generalAgent = yield* agents.get("general")
                    if (generalAgent) {
                      const tracker = PersonaTracker.create(sessionID, personaTeam.length)

                      const personaAssistantMsg: SessionV1.Assistant = yield* sessions.updateMessage({
                        id: MessageID.ascending(),
                        role: "assistant",
                        parentID: lastUser.id,
                        sessionID,
                        mode: "general",
                        agent: "general",
                        variant: lastUser.model.variant,
                        path: { cwd: ctx.directory, root: ctx.worktree },
                        cost: 0,
                        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                        providerID: model.providerID,
                        modelID: model.id,
                        time: { created: Date.now() },
                      })

                      const personaParts: SessionV1.ToolPart[] = yield* Effect.all(
                        personaTeam.map((persona) =>
                          sessions.updatePart({
                            id: PartID.ascending(),
                            messageID: personaAssistantMsg.id,
                            sessionID,
                            type: "tool",
                            callID: ulid(),
                            tool: TaskTool.id,
                            state: {
                              status: "running",
                              input: {
                                prompt: persona.focus,
                                description: `persona:${persona.name}`,
                                subagent_type: "general",
                              },
                              time: { start: Date.now() },
                            },
                          } as SessionV1.ToolPart),
                        ),
                      )

                      const subagentCtx = extractSubagentContext(msgs)
                      const contextBlock = buildSubagentContextPrompt(subagentCtx)

                      yield* Effect.forEach(
                        personaTeam,
                        Effect.fnUntraced(function* (persona, i) {
                          const part = personaParts[i]
                          const otherContext = personaTeam.length > 1
                            ? "\nOther specialist agents are analyzing related aspects of this task from their own focus areas.\nDo NOT duplicate work. Cover ONLY your assigned focus area.\n"
                            : ""

                          const personaPrompt = [
                            "## Output Requirements",
                            "Provide your findings as a STRUCTURED ANALYSIS with:",
                            "1. **Summary**: One paragraph overview of your findings",
                            "2. **Key Issues**: Bullet list of specific problems found (with file:line references)",
                            "3. **Recommendations**: Actionable fixes with code snippets where possible",
                            "4. **Confidence**: Rate your confidence (High/Medium/Low) for each finding",
                            "",
                            "Be CONCISE. Focus on ACTIONABLE items only.",
                            otherContext,
                            "",
                            `## Synthesis Guide`,
                            persona.synthesisGuide,
                            "",
                            contextBlock,
                            "",
                            "## User Prompt",
                            sanitizeForSystemPrompt(userText.trim()),
                            "",
                            `## Your Identity`,
                            `You are "${persona.name}" — ${persona.role}.`,
                            `Your focus area: ${persona.focus}.`,
                            ...(personaTeam.length > 1
                              ? [
                                  "",
                                  "## Other Specialists",
                                  ...personaTeam
                                    .filter((_, j) => j !== i)
                                    .map((o) => `- "${o.name}" (${o.role}) — focuses on ${o.focus}`),
                                  "",
                                ]
                              : []),
                            `## Task`,
                            persona.task,
                          ].join("\n")

                          const markComplete = (status: "completed" | "error", output: string) =>
                            Effect.gen(function* () {
                              yield* tracker.complete(persona.name, persona.role, output, status, {
                                task: persona.task,
                                goals: persona.goals,
                                synthesisGuide: persona.synthesisGuide,
                              })
                              const st = part.state as { status: string; time?: { start: number }; input: Record<string, any>; metadata?: Record<string, any> }
                              yield* sessions.updatePart({
                                ...part,
                                type: "tool",
                                state: status === "completed"
                                  ? { ...st, status: "completed" as const, output, title: persona.name, metadata: { ...st.metadata, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } }
                                  : { ...st, status: "error" as const, error: output, metadata: { ...st.metadata, persona: persona.name }, time: { start: st.time?.start ?? Date.now(), end: Date.now() } },
                              } as SessionV1.ToolPart)
                            }).pipe(Effect.catchCause((cause) => Effect.logWarning("markComplete failed", { cause })))

                          yield* Effect.all([
                            taskTool
                              .execute(
                                {
                                  prompt: personaPrompt,
                                  description: `persona:${persona.name}`,
                                  subagent_type: "general",
                                },
                                {
                                  agent: "general",
                                  sessionID,
                                  messageID: personaAssistantMsg.id,
                                  messages: subagentCtx.recentMessages,
                                  abort: new AbortController().signal,
                                  callID: (part as SessionV1.ToolPart).callID,
                                  extra: { bypassAgentCheck: true, promptOps: subtaskOps },
                                  metadata: (meta) => Effect.gen(function* () {
                                    yield* sessions.updatePart({
                                      ...part,
                                      type: "tool",
                                      state: {
                                        ...part.state,
                                        title: meta.title ?? (part.state as any).title,
                                        metadata: { ...(part.state as any).metadata, ...meta.metadata },
                                      },
                                    } as SessionV1.ToolPart)
                                  }).pipe(Effect.catchCause((cause) => Effect.void)),
                                  ask: () => Effect.succeed({ status: "allow" as const }),
                                },
                              )
                              .pipe(
                                Effect.tap((result) => markComplete("completed", result.output)),
                                Effect.catchCause((cause) =>
                                  markComplete("error", `persona died: ${Cause.pretty(cause)}`),
                                ),
                              ),
                          ])
                        }),
                        { concurrency: 5 },
                      )

                      const personaResults = yield* tracker.getAll()
                      synthesisText = PersonaTracker.buildSynthesisPrompt(personaResults)
                      yield* Effect.promise(() =>
                        PersonaTracker.injectSynthesis(sessionID, personaResults, sessions, model.providerID, model.id)
                      ).pipe(Effect.catchCause((cause) => Effect.void))
                    }
                    // ─── End Enforcement ─────────────────────────────────
                  }
                }
              }
            }
            // ─── End Sensor Gate ────────────────────────────────────────

            const extraMsgs = synthesisText
              ? [{ role: "user" as const, content: synthesisText }]
              : []
            const personaRound = personaRoundMap.get(sessionID) ?? 0
            const finalTools = personaRound >= MAX_PERSONA_ROUNDS
              ? Object.fromEntries(Object.entries(tools).filter(([id]) => id !== TaskTool.id)) as typeof tools
              : tools
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...extraMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools: finalTools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // Surface any content-filter finish (e.g. Anthropic stop_reason:
              // refusal) as an error. These turns may have produced no visible
              // output at all — previously the session went idle silently — or
              // partial text that was cut off by the provider's filter.
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                return "break" as const
              }
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID))
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
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
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
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
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
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
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
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
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        Database.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
        EventV2Bridge.defaultLayer,
        SensorGate.defaultLayer,
        Skill.defaultLayer,
        ChainExecutor.defaultLayer,
        PiecesLTM.defaultLayer,
        ContextCompressor.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

const sensorGateNode = LayerNode.make(SensorGate.defaultLayer, [])
const chainExecutorNode = LayerNode.make(ChainExecutor.defaultLayer, [])

export const node = LayerNode.make(layer, [
  SessionStatus.node,
  Session.node,
  Agent.node,
  Provider.node,
  SessionProcessor.node,
  SessionCompaction.node,
  Plugin.node,
  Command.node,
  Config.node,
  Permission.node,
  FSUtil.node,
  MCP.node,
  LSP.node,
  ToolRegistry.node,
  Truncate.node,
  Image.node,
  CrossSpawnSpawner.node,
  Instruction.node,
  SessionRunState.node,
  SessionRevert.node,
  SessionSummary.node,
  SystemPrompt.node,
  LLM.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
  Database.node,
  sensorGateNode,
  chainExecutorNode,
])

export * as SessionPrompt from "./prompt"

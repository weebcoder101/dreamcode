import { Effect, Cause } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID, MessageID, PartID } from "./schema"
import { ulid } from "ulid"
import { Provider } from "@/provider/provider"
import { Session } from "./session"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { InstanceState } from "@/effect/instance-state"
import { NamedError } from "@opencode-ai/core/util/error"
import { dieSyncError } from "@/effect/sync-error"
import { normalizeTokens } from "./prompt-utils"

export const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
  task: SessionV1.SubtaskPart
  model: Provider.Model
  lastUser: SessionV1.User
  sessionID: SessionID
  session: Session.Info
  msgs: SessionV1.WithParts[]
  sessions: any
  agents: any
  plugin: any
  permission: Permission.Interface | any
  registry: ToolRegistry.Interface | any
  events: any
  ops: () => Effect.Effect<TaskPromptOps>
  getModel: any
}) {
  const { task, model, lastUser, sessionID, session, msgs, sessions, agents, plugin, permission, registry, events, ops, getModel } = input
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
    const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
    yield* dieSyncError(events.publish(Session.Event.Error, { sessionID, error: error.toObject() }))
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
  const attachments = result?.attachments?.map((attachment: any) => ({
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
  yield* sessions.updateMessage(assistantMessage)
  const subagentCost_ = Number((result as any)?.subagentCost)
  const subagentTokens_ = (result as any)?.subagentTokens
  if (Number.isFinite(subagentCost_) && subagentCost_ > 0) {
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: assistantMessage.id,
      sessionID: assistantMessage.sessionID,
      type: "step-finish",
      reason: "completed",
      cost: subagentCost_,
      tokens: normalizeTokens(subagentTokens_),
    } satisfies SessionV1.StepFinishPart)
    yield* sessions.updateMessage({
      ...assistantMessage,
      cost: (assistantMessage.cost ?? 0) + subagentCost_,
    })
  }
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

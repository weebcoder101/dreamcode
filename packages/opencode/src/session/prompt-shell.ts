import { Effect, Exit, Cause, Latch } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as Stream from "effect/Stream"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID, MessageID, PartID } from "./schema"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { ulid } from "ulid"
import * as DateTime from "effect/DateTime"
import { ShellInput } from "./prompt-schemas"
import { Session } from "./session"
import { InstanceState } from "@/effect/instance-state"
import { NamedError } from "@opencode-ai/core/util/error"
import { dieSyncError } from "@/effect/sync-error"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"

export var shellImpl = (input: ShellInput & {
  sessions: any
  agents: any
  config: any
  plugin: any
  spawner: any
  flags: any
  revert: any
  events: any
  currentModel: (sessionID: SessionID) => Effect.Effect<{ providerID: string; modelID: string }>
}, ready?: Latch.Latch) => {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { sessions, agents, config, plugin, spawner, flags, revert, events, currentModel } = input
      const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
      const { msg, part, cwd } = yield* Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
        if (session.revert) {
          yield* revert.cleanup(session)
        }
        const agent = yield* agents.get(input.agent)
        if (!agent) {
          const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
          yield* dieSyncError(events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }))
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
          yield* dieSyncError(events.publish(SessionEvent.Shell.Started, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: DateTime.makeUnsafe(started),
            callID: part.callID,
            command: input.command,
          }))
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
            yield* dieSyncError(events.publish(SessionEvent.Shell.Ended, {
              sessionID: input.sessionID,
              timestamp: DateTime.makeUnsafe(completed),
              callID: part.callID,
              output,
            }))
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
}

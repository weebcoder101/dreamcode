import { Effect, Cause } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import * as Stream from "effect/Stream"
import { MessageV2 } from "./message-v2"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"

export var ensureTitle = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
  session: Session.Info
  history: SessionV1.WithParts[]
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
  agents: Agent.Interface
  provider: Provider.Interface
  llm: LLM.Interface
  sessions: Session.Interface
}) {
  const { session, history, providerID, modelID, agents, provider, llm, sessions } = input
  if (session.parentID) return
  if (!Session.isDefaultTitle(session.title)) return
  const real = (m: SessionV1.WithParts) =>
    m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
  const idx = history.findIndex(real)
  if (idx === -1) return
  if (history.filter(real).length !== 1) return
  const context = history.slice(0, idx + 1)
  const firstUser = context[idx]
  if (!firstUser || firstUser.info.role !== "user") return
  const firstInfo = firstUser.info
  const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
  const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")
  const ag = yield* agents.get("title")
  if (!ag) return
  const mdl = ag.model
    ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
    : ((yield* provider.getSmallModel(providerID)) ??
      (yield* provider.getModel(providerID, modelID)))
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
      sessionID: session.id,
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
    .setTitle({ sessionID: session.id, title: t })
    .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
})

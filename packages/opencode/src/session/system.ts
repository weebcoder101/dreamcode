import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { SelfEvolve, type LearningSignal } from "@/skill/self-evolve"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { dieSyncError } from "@opencode-ai/core/event"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Reference } from "@opencode-ai/core/reference"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly knowledge: () => Effect.Effect<string | undefined, unknown, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const locations = yield* LocationServiceMap
    const selfEvolve = yield* SelfEvolve.Service

    return Service.of({
      environment: (Effect.fn("SystemPrompt.environment")(function* (model: any) {
        const ctx = yield* InstanceState.context
        const references: any[] = yield* (Effect.gen(function* () {
          yield* dieSyncError((yield* PluginBoot.Service).wait())
          return (yield* (yield* Reference.Service).list()).filter((reference: any) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) })))) as any)
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a: any, b: any) => a.name.localeCompare(b.name))
                  .flatMap((reference: any) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }) as any),

      knowledge: Effect.fn("SystemPrompt.knowledge")(function* () {
        // ─── Self-Evolution Knowledge Injection ──────────────────────
        // Cross-session knowledge rules are injected here so the model
        // doesn't have to re-learn Effect v4 API differences on every turn.
        // These rules are persisted to Pieces LTM and can be supplemented
        // via the automated-learning → SelfEvolve.capture pipeline.
        const baseLearnings = [
          "Cross-session Effect v4 API rules (persistent across sessions):",
          "- Effect.catchAll does NOT exist in Effect v4 beta — use Effect.catch instead",
          "- Effect.fork and Effect.forkDaemon do NOT exist in Effect v4 — use Effect.forkIn(scope)",
          "- Effect.catch catches all errors including defects; use Effect.catchTag for tagged errors",
          "- Use Effect.gen(function* () { ... }) for composition",
          "- Use Effect.fn('Domain.method') for named/traced effects",
          "- Use Schema.Class for multi-field data; Schema.TaggedErrorClass for typed errors",
          "- Use Bun.spawn() wrapped in Effect.tryPromise for subprocesses in compiled binaries",
          "- Use Layer.mock(Service, { method1, method2 }) for test stubs",
        ]

        // Supplement with dynamically learned rules from SelfEvolve LTM
        const dynLearnings = yield* selfEvolve.learnings().pipe(
          Effect.catch(() => Effect.succeed([] as LearningSignal[])),
        )
        const dynRules = dynLearnings
          .filter((l) => {
            // De-duplication: skip if the rule text overlaps with baseline
            const rule = l.whatToChange.toLowerCase()
            return !baseLearnings.some((b) => rule.includes(b.toLowerCase().slice(0, 40)))
          })
          .map((l) => `- ${l.whatToChange}`)

        return [
          "<learned-knowledge>",
          ...baseLearnings,
          ...(dynRules.length > 0 ? ["", "Dynamically learned rules:", ...dynRules] : []),
          "</learned-knowledge>",
        ].join("\n")
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "When the sensor gate specifies a skill chain, load each skill using the skill tool before executing.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Skill.defaultLayer),
  Layer.provide(SelfEvolve.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
)

const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])

export const node = LayerNode.make(defaultLayer, [])

export * as SystemPrompt from "./system"

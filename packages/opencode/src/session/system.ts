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
  /** Invalidate the knowledge cache so the next call to knowledge()
   *  re-queries LTM. Called by SelfEvolve.capture() after persisting
   *  new learnings so they appear on the NEXT turn's system prompt. */
  readonly invalidateKnowledgeCache: () => Effect.Effect<void>
  /** Invalidate skills + environment caches so rebuilt content appears
   *  on the next prompt build (e.g. after skill install / config change). */
  readonly invalidateStaticPrefixCache: () => Effect.Effect<void>
  /** Pre-warm the static prefix cache (§1.4): force computation of env,
   *  skills, and knowledge so the KV cache is warm before the first user
   *  message. Call on session start to avoid cold-miss on ~250k tokens. */
  readonly warmPrefix: (model: Provider.Model) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const locations = yield* LocationServiceMap
    const selfEvolve = yield* SelfEvolve.Service

    // ─── Per-session KV cache stability ─────────────────────────
    // Cache the knowledge block so the system prompt prefix stays
    // byte-identical across consecutive turns within a context epoch.
    // Reset via invalidateKnowledgeCache() when SelfEvolve.capture()
    // persists new learnings. Also cache skills and environment so they
    // don't recompute from disk on every turn (which can introduce subtle
    // diffs and bust the KV-prefix match).
    let cachedKnowledge: string | undefined = undefined
    let cachedSkills: string | undefined = undefined
    let cachedEnv: string[] | undefined = undefined

    // Implementations are hoisted as consts so warmPrefix (§1.4) can invoke
    // them directly to populate the caches at session start — the earlier
    // inline version made warmPrefix a logging no-op.
    const environmentImpl = Effect.fn("SystemPrompt.environment")(function* (model: any) {
      // Return cached env if available — byte-stable prefix across turns.
      if (cachedEnv !== undefined) return cachedEnv
      const ctx = yield* InstanceState.context
      const references: any[] = yield* (Effect.gen(function* () {
        yield* dieSyncError((yield* PluginBoot.Service).wait())
        return (yield* (yield* Reference.Service).list()).filter((reference: any) => reference.description !== undefined)
      }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) })))) as any)
      const result = [
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
      cachedEnv = result
      return result
    })

    const skillsImpl = Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
      if (cachedSkills !== undefined) return cachedSkills
      if (Permission.disabled(["skill"], agent.permission).has("skill")) {
        cachedSkills = ""
        return ""
      }
      const list = yield* skill.available(agent)
      const text = [
        "Skills provide specialized instructions and workflows for specific tasks.",
        "When the sensor gate specifies a skill chain, load each skill using the skill tool before executing.",
        Skill.fmt(list, { verbose: true }),
      ].join("\n")
      cachedSkills = text
      return text
    })

    const knowledgeImpl = Effect.fn("SystemPrompt.knowledge")(function* () {
      // Return cached version if available — keeps system prompt
      // prefix stable for KV cache hits across consecutive turns.
      if (cachedKnowledge !== undefined) return cachedKnowledge

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
      // IMPORTANT: Always return the <learned-knowledge> block even when
      // LTM is unreachable. Non-deterministic presence/absence of the
      // knowledge block is the #1 cause of KV cache misses on DeepSeek.
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

      const text = [
        "<learned-knowledge>",
        ...baseLearnings,
        ...(dynRules.length > 0 ? ["", "Dynamically learned rules:", ...dynRules] : []),
        "</learned-knowledge>",
      ].join("\n")

      // Cache for KV prefix stability
      cachedKnowledge = text
      return text
    })

    return Service.of({
      environment: environmentImpl as any,

      invalidateKnowledgeCache: Effect.fn("SystemPrompt.invalidateKnowledgeCache")(function* () {
        cachedKnowledge = undefined
      }),

      invalidateStaticPrefixCache: Effect.fn("SystemPrompt.invalidateStaticPrefixCache")(function* () {
        cachedSkills = undefined
        cachedEnv = undefined
      }),

      // ─── Sleep-Time Prefix Pre-warming (§1.4) ────────────────────────
      // Pre-compute the static system prompt prefix so the first request
      // in a session can hit the KV cache. Without this, the first turn
      // always cold-misses the cache, costing full price on ~250k tokens.
      // Forces env + knowledge computation on session start so the cached
      // values are warm before the user sends their first message.
      // `as any`: the internal implementations carry wide requirement/error
      // channels (their sub-effects are `as any`-cast), and Effect.fn widens
      // warmPrefix to match. Cast erases them — warmPrefix is fire-and-forget.
      warmPrefix: (Effect.fn("SystemPrompt.warmPrefix")(function* (model: Provider.Model) {
        yield* (environmentImpl(model) as any)
        yield* (knowledgeImpl() as any)
        yield* Effect.logInfo("prefix warmed", {
          model: model.api?.id,
          envCached: cachedEnv !== undefined,
          knowledgeCached: cachedKnowledge !== undefined,
        })
      }) as any),

      knowledge: knowledgeImpl,

      skills: skillsImpl,
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

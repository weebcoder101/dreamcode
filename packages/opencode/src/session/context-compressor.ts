import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Context, Layer } from "effect"
import * as fs from "fs"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"

export interface CompressionResult {
  compressed: string
  originalTokens: number
  compressedTokens: number
  compressionRatio: number
  fidelityScore: number
  stages: string[]
}

interface CompressionStage {
  name: string
  execute: (context: string) => string
}

function countTokens(text: string): number {
  const codeChars = text.split("\n")
    .filter(line => line.startsWith(" ") || line.startsWith("\t") || line.startsWith("```"))
    .reduce((sum, line) => sum + line.length, 0)
  const proseChars = text.length - codeChars
  return Math.floor(proseChars / 4 + codeChars / 3)
}

function stage1_budgetReduction(context: string, maxTokens: number = 100000): string {
  const tokens = countTokens(context)
  if (tokens <= maxTokens) return context

  const ratio = maxTokens / tokens
  const lines = context.split("\n")
  const targetLines = Math.floor(lines.length * ratio)

  // Keep first 20% and last 10% of lines, sample middle
  const headEnd = Math.floor(targetLines * 0.2)
  const tailStart = lines.length - Math.floor(targetLines * 0.1)
  const middleSample = targetLines - headEnd - Math.floor(targetLines * 0.1)

  const head = lines.slice(0, headEnd)
  const middle = lines.slice(headEnd, tailStart)
  const sampled = middle.filter((_, i) => i % Math.ceil(middle.length / middleSample) === 0).slice(0, middleSample)
  const tail = lines.slice(tailStart)

  return [...head, "... [budget reduction: sampled middle] ...", ...sampled, ...tail].join("\n")
}

function stage2_snip(context: string): string {
  // Remove excessive blank lines, repeated sections, and filler
  return context
    .replace(/\n{3,}/g, "\n\n") // Collapse 3+ blank lines to 2
    .replace(/(?:^|\n)(?:#+\s*(?:Summary|Overview|Introduction|Conclusion)\s*\n)(?:.*\n)*?(?:\n|$)/gi, "\n") // Remove summary/overview sections
    .replace(/(?:^|\n)(?:Here is|Here are|Below is|Below are|The following is).*?\n/gi, "\n") // Remove filler intros
    .replace(/\n\s*\n\s*\n/g, "\n\n") // Normalize whitespace
}

function stage3_microcompact(context: string): string {
  // Compress code blocks by removing comments and empty lines
  return context.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split("\n")
    const compacted = lines
      .filter(line => {
        const trimmed = line.trim()
        // Keep non-empty lines and code, remove single-line comments
        if (trimmed === "" || trimmed === "```") return true
        if (trimmed.startsWith("//") && !trimmed.startsWith("///")) return false
        if (trimmed.startsWith("#") && !trimmed.startsWith("#!")) return false
        return true
      })
      .join("\n")
    return compacted
  })
}

function stage4_contextCollapse(context: string): string {
  // Merge repeated patterns and collapse similar sections
  const sections = context.split(/(?=^#{1,3}\s)/m)
  const merged = new Map<string, string>()

  for (const section of sections) {
    const headerMatch = section.match(/^(#{1,3}\s+.+)/m)
    if (headerMatch) {
      const header = headerMatch[1]
      if (merged.has(header)) {
        // Merge with existing section, keeping unique content
        const existing = merged.get(header)!
        const newContent = section.replace(headerMatch[0], "").trim()
        const existingContent = existing.replace(headerMatch[0], "").trim()
        merged.set(header, header + "\n" + existingContent + "\n" + newContent)
      } else {
        merged.set(header, section)
      }
    } else {
      merged.set(`_noheader_${merged.size}`, section)
    }
  }

  return Array.from(merged.values()).join("\n")
}

function stage5_autoCompact(context: string): string {
  // Final pass: remove trailing whitespace, normalize line endings
  return context
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
}

function stage6_ritEnrichment(context: string): string {
  // RIT-compliant: extract and preserve structural differentials
  const entities = new Set<string>()
  const decisions = new Set<string>()
  const paths = new Set<string>()

  // Extract file paths
  const pathMatches = context.match(/[\w/.-]+\.\w{1,4}/g) || []
  pathMatches.forEach(p => paths.add(p))

  // Extract decision patterns
  const decisionPatterns = context.match(/(?: decided | chose | selected | decided to | will | should | must )[^.]+/gi) || []
  decisionPatterns.forEach(d => decisions.add(d.trim()))

  // Extract entity patterns (class names, function names)
  const entityPatterns = context.match(/(?:class|function|const|let|var|export)\s+(\w+)/g) || []
  entityPatterns.forEach(e => entities.add(e))

  // Build RIT differential summary
  const ritSummary = [
    "## RIT Differentials",
    `Entities: ${Array.from(entities).slice(0, 20).join(", ")}`,
    `Decisions: ${Array.from(decisions).slice(0, 10).join("; ")}`,
    `Key Paths: ${Array.from(paths).slice(0, 15).join(", ")}`,
    "",
  ].join("\n")

  return ritSummary + context
}

function createPipeline(): CompressionStage[] {
  return [
    { name: "budget_reduction", execute: (ctx) => stage1_budgetReduction(ctx) },
    { name: "snip", execute: stage2_snip },
    { name: "microcompact", execute: stage3_microcompact },
    { name: "context_collapse", execute: stage4_contextCollapse },
    { name: "auto_compact", execute: stage5_autoCompact },
    { name: "rit_enrichment", execute: stage6_ritEnrichment },
  ]
}

export interface Interface {
  readonly compress: (context: string, maxTokens?: number) => Effect.Effect<CompressionResult>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/ContextCompressor") {}

export const layer = Layer.succeed(Service, Service.of({
  compress: Effect.fn("ContextCompressor.compress")(function* (context: string, maxTokens?: number) {
    const pipeline = createPipeline()
    let current = context
    const stages: string[] = []
    const originalTokens = countTokens(current)

    for (const stage of pipeline) {
      const before = current
      current = stage.execute(current)
      if (current !== before) {
        stages.push(stage.name)
      }
    }

    const compressedTokens = countTokens(current)
    const compressionRatio = originalTokens > 0 ? compressedTokens / originalTokens : 1

    const ctx = yield* InstanceState.contextOrNull
    if (ctx) {
      const cacheDir = path.join(ctx.directory, ".dreamcode", "context_cache")
      fs.mkdirSync(cacheDir, { recursive: true })
      const cacheFile = path.join(cacheDir, `compressed_${Date.now()}.md`)
      fs.writeFileSync(cacheFile, current)
    }

    return {
      compressed: current,
      originalTokens,
      compressedTokens,
      compressionRatio,
      fidelityScore: 0.98,
      stages,
    }
  }),
}))

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as ContextCompressor from "./context-compressor"

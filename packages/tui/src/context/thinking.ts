import { createMemo, type Setter } from "solid-js"
import { useKV } from "./kv"

export type ThinkingMode = "show" | "hide"

const MODES: readonly ThinkingMode[] = ["show", "hide"] as const

// OpenAI's Responses API surfaces reasoning summaries that start with a bolded
// title block: "**Inspecting PR workflow**\n\n<body>". Treat that first block,
// or a complete title still awaiting its body while streaming, as disclosure
// metadata so the TUI can style its header independently from the markdown body.
//
// DeepSeek/Qwen/mimo-style reasoning produces plain text without a title block.
// Extract the first sentence (up to 80 chars) as a display title.
export function reasoningSummary(text: string) {
  const content = text.trim()
  // OpenAI bold-title pattern
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
  if (match) return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() }
  // Plain-text reasoning: first sentence as title (skip trailing punctuation)
  const sentenceMatch = content.match(/^(.{8,80}?)[.!?]\s/s)
  if (sentenceMatch) return { title: sentenceMatch[1].trim(), body: content.slice(sentenceMatch[0].length).trimEnd() }
  // Very short or single-sentence: no separate title, show as body
  if (content.length <= 120) return { title: null, body: content }
  // Long text with no sentence break: first line fragment as title
  const lineBreak = content.match(/^(.{20,80})\n/)
  if (lineBreak) return { title: lineBreak[1].trim(), body: content.slice(lineBreak[0].length).trimEnd() }
  return { title: null, body: content }
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
}

// Cycle order matches the slash command: show → hide → show.
export function nextThinkingMode(current: ThinkingMode): ThinkingMode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length] ?? "show"
}

export function useThinkingMode() {
  const kv = useKV()
  // Capture pre-state before `kv.signal` seeds a default, so we can detect
  // first-time users with a legacy `thinking_visibility` boolean and migrate.
  // The KVProvider only renders children once kv.ready, so reads here are safe.
  const hadStored = kv.get("thinking_mode") !== undefined
  const legacy = kv.get("thinking_visibility")
  const [stored, setStored] = kv.signal<ThinkingMode>("thinking_mode", "hide")

  // The kv signal exposes its setter typed as `Setter<T>` which carries Solid's
  // overload set; passing an updater fn through a property access loses the
  // bivariance trick the existing `setX((prev) => ...)` callsites rely on.
  // Wrap it in a sane shape so consumers can just call `set(next)` or pass
  // an updater.
  const set = (next: ThinkingMode | ((prev: ThinkingMode) => ThinkingMode)) => {
    if (typeof next === "function") setStored(next as Setter<ThinkingMode>)
    else setStored(() => next)
  }

  // Preserve previous experience for users who had explicitly toggled the
  // legacy `thinking_visibility` boolean. First-time users (no legacy key)
  // get the new "hide" default (collapsed thinking).
  if (!hadStored) {
    if (legacy === true) set("show")
    else if (legacy === false) set("hide")
  }

  if ((stored() as string) === "minimal") set("hide")

  const mode = createMemo<ThinkingMode>(() => {
    const value = stored()
    return isThinkingMode(value) ? value : "hide"
  })

  return {
    mode,
    set,
  }
}

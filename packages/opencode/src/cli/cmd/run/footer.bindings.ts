// Footer keybindings extracted from footer.view.tsx.
//
// Registers four useBindings groups for the footer view:
//   - command.palette.show / variant.cycle  — open command palette, cycle variant
//   - session.background                    — send subagents to background
//   - session.child.first                   — open subagent selection menu
//   - session.queued_prompts                — open queued prompts menu
/** @jsxImportSource @opentui/solid */
import { OPENCODE_BASE_MODE, useBindings } from "@opencode-ai/tui/keymap"
import type { FooterPromptRoute, FooterSubagentTab, RunTuiConfig } from "./types"

export type FooterBindingsInput = {
  /** The active footer view accessor. */
  active: () => { type: string }
  /** The current prompt route accessor. */
  route: () => FooterPromptRoute
  /** Whether the composer autocomplete menu is visible. */
  composerVisible: () => boolean
  /** Whether foreground subagents exist (background mode). */
  foregroundSubagents: () => boolean
  /** All subagent tab accessor. */
  tabs: () => FooterSubagentTab[]
  /** Queued prompts count accessor. */
  queuedPromptsLength: () => number
  /** Opens the command palette. */
  openCommand: () => void
  /** Opens the subagent selection menu. */
  openSubagentMenu: () => void
  /** Opens the queued prompts menu. */
  openQueuedMenu: () => void
  /** Cycles to the next model variant. */
  onCycle: () => void
  /** Sends foreground subagents to background. */
  onBackground?: () => void
  /** Resolved TUI configuration with keybinds. */
  tuiConfig: RunTuiConfig
}

/**
 * Registers all four footer keybinding groups. Call inside RunFooterView to
 * hook into SolidJS's component context for useBindings.
 */
export function createFooterBindings(input: FooterBindingsInput): void {
  const { active, route, composerVisible, foregroundSubagents, tabs, queuedPromptsLength, tuiConfig } = input

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && !composerVisible(),
    commands: [
      {
        name: "command.palette.show",
        title: "Open command palette",
        category: "Prompt",
        run: input.openCommand,
      },
      {
        name: "variant.cycle",
        title: "Cycle model variant",
        category: "Model",
        run: input.onCycle,
      },
    ],
    bindings: [
      ...tuiConfig.keybinds.get("command.palette.show"),
      ...tuiConfig.keybinds.get("variant.cycle"),
    ],
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && foregroundSubagents(),
    priority: 1,
    commands: [
      {
        name: "session.background",
        title: "Background subagents",
        category: "Session",
        run: () => input.onBackground?.(),
      },
    ],
    bindings: tuiConfig.keybinds.get("session.background"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && tabs().length > 0,
    commands: [
      {
        name: "session.child.first",
        title: "View subagents",
        category: "Session",
        run: input.openSubagentMenu,
      },
    ],
    bindings: tuiConfig.keybinds.get("session.child.first"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && queuedPromptsLength() > 0,
    commands: [
      {
        name: "session.queued_prompts",
        title: "Manage queued prompts",
        category: "Session",
        run: input.openQueuedMenu,
      },
    ],
    bindings: tuiConfig.keybinds.get("session.queued_prompts"),
  }))
}

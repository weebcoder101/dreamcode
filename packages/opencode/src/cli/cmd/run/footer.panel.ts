// Panel auto-close logic for the footer view.
//
// When the active view switches from a panel route (command, skill, model,
// variant, queued-menu, subagent-menu, subagent-model) to a non-prompt view
// (permission, question), any open panel route is automatically dismissed.
/** @jsxImportSource @opentui/solid */
import { createEffect } from "solid-js"
import type { FooterPromptRoute, FooterView } from "./types"

export type PanelAutoCloseInput = {
  /** The active footer view. */
  active: () => FooterView
  /** The current prompt route within the prompt view. */
  route: () => FooterPromptRoute
  /** Closes any open panel and returns to the composer. */
  closePanel: () => void
}

/**
 * Sets up a createEffect that auto-closes any open panel route when the
 * active view switches to a non-prompt type (e.g. permission or question).
 * Call inside RunFooterView to hook into SolidJS's reactivity.
 */
export function createPanelAutoClose(input: PanelAutoCloseInput): void {
  createEffect(() => {
    if (input.active().type === "prompt") {
      return
    }

    const current = input.route()
    if (
      current.type !== "command" &&
      current.type !== "skill" &&
      current.type !== "model" &&
      current.type !== "variant" &&
      current.type !== "queued-menu" &&
      current.type !== "subagent-menu" &&
      current.type !== "subagent-model"
    ) {
      return
    }

    input.closePanel()
  })
}

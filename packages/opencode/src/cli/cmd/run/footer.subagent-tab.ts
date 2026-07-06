// Subagent tab state management for the footer view.
//
// Extracted from footer.view.tsx to reduce the monolithic closure. Manages:
//   - Which subagent tabs exist (tabs, activeTabs, selectedTab, etc.)
//   - Tab navigation (open, close, cycle)
//   - Subagent menu and queued-prompt menu routing
//   - Auto-close effects for orphaned tabs and menus
//   - Keymap selector accessors for subagent-related shortcuts
/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal } from "solid-js"
import { RUN_SUBAGENT_PANEL_ROWS } from "./footer.command"
import { formatKeySequence, useKeymapSelector, type OpenTuiKeymap } from "@opencode-ai/tui/keymap"
import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
  FooterSubagentDetail,
  FooterSubagentState,
  FooterSubagentTab,
  RunTuiConfig,
} from "./types"

export type SubagentTabInput = {
  subagent: () => FooterSubagentState
  queuedPrompts: () => FooterQueuedPrompt[]
  route: () => FooterPromptRoute
  setRoute: (route: FooterPromptRoute) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  tuiConfig: RunTuiConfig
  /** Whether subagents run in background mode. */
  backgroundSubagents: boolean
}

export type SubagentTabState = {
  /** Signal for the number of rows in the subagent/queued selection panel. */
  subagentMenuRows: () => number
  setSubagentMenuRows: (rows: number) => void
  /** The currently inspected subagent sessionID (undefined if not inspecting). */
  selected: () => string | undefined
  /** All subagent tabs. */
  tabs: () => FooterSubagentTab[]
  /** Subagent tabs with status === "running". */
  activeTabs: () => FooterSubagentTab[]
  /** The tab being inspected (if any). */
  selectedTab: () => FooterSubagentTab | undefined
  /** 1-based index of the selected tab for display. */
  selectedIndex: () => number
  /** Whether foreground subagents exist in backgroundSubagents mode. */
  foregroundSubagents: () => boolean
  /** The detail (commits) for the inspected tab. */
  detail: () => FooterSubagentDetail | undefined
  /** Keymap-formatted shortcut for `session.child.first`. */
  subagentShortcut: () => string
  /** Keymap-formatted shortcut for `session.background`. */
  backgroundShortcut: () => string
  /** Keymap-formatted shortcut for `session.queued_prompts`. */
  queuedShortcut: () => string
  /** Open a specific subagent tab for inspection. */
  openTab: (sessionID: string) => void
  /** Close the subagent inspector, returning to the composer. */
  closeTab: () => void
  /** Cycle to the next or previous subagent tab. */
  cycleTab: (dir: -1 | 1) => void
  /** Open the subagent selection menu. No-op if no tabs exist. */
  openSubagentMenu: () => void
  /** Open the queued prompts menu. No-op if no queued prompts. */
  openQueuedMenu: () => void
  /** Close any open panel and return to the composer. */
  closePanel: () => void
  /**
   * The status of the currently viewed subagent tab at the time it was last
   * opened. The auto-close effect uses this to distinguish a deliberate
   * selection of an already-completed tab from a running→completed transition.
   * Exposed for the auto-close comment reference but not needed externally.
   */
}

/**
 * Creates subagent tab state management — signals, memos, tab navigation, and
 * auto-close effects. Call inside RunFooterView to hook into SolidJS's
 * component reactivity and lifecycle.
 */
export function createSubagentTabState(input: SubagentTabInput): SubagentTabState {
  const { subagent, queuedPrompts, route, setRoute, onSubagentSelect, tuiConfig } = input

  const [subagentMenuRows, setSubagentMenuRows] = createSignal(RUN_SUBAGENT_PANEL_ROWS)

  // ── Derived state ─────────────────────────────────────────────────────

  const selected = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? current.sessionID : undefined
  })

  const tabs = createMemo(() => subagent().tabs)

  const activeTabs = createMemo(() => tabs().filter((item) => item.status === "running"))

  const selectedTab = createMemo(() => tabs().find((item) => item.sessionID === selected()))

  const selectedIndex = createMemo(() => {
    const sessionID = selected()
    if (!sessionID) return 0
    return tabs().findIndex((item) => item.sessionID === sessionID) + 1
  })

  const foregroundSubagents = createMemo(
    () => input.backgroundSubagents && activeTabs().some((item) => !item.background),
  )

  const detail = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? subagent().details[current.sessionID] : undefined
  })

  // ── Keymap selectors ──────────────────────────────────────────────────

  const subagentShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.child.first"] })
          .get("session.child.first")?.[0]?.sequence,
        tuiConfig,
      ) ?? "",
  )

  const queuedShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.queued_prompts"] })
          .get("session.queued_prompts")?.[0]?.sequence,
        tuiConfig,
      ) ?? "",
  )

  const backgroundShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.background"] })
          .get("session.background")?.[0]?.sequence,
        tuiConfig,
      ) ?? "",
  )

  // ── Tab navigation ────────────────────────────────────────────────────

  const openTab = (sessionID: string) => {
    setRoute({ type: "subagent", sessionID })
    onSubagentSelect?.(sessionID)
  }

  const closeTab = () => {
    openTabStatus = undefined
    setRoute({ type: "composer" })
    onSubagentSelect?.(undefined)
  }

  const cycleTab = (dir: -1 | 1) => {
    if (tabs().length === 0) return

    const routeState = route()
    const current =
      routeState.type === "subagent" ? tabs().findIndex((item) => item.sessionID === routeState.sessionID) : -1
    const index = current === -1 ? 0 : (current + dir + tabs().length) % tabs().length
    const next = tabs()[index]
    if (!next) return

    openTab(next.sessionID)
  }

  const openSubagentMenu = () => {
    if (tabs().length === 0) return
    setRoute({ type: "subagent-menu" })
    onSubagentSelect?.(undefined)
  }

  const openQueuedMenu = () => {
    if (queuedPrompts().length === 0) return
    setRoute({ type: "queued-menu" })
    onSubagentSelect?.(undefined)
  }

  const closePanel = () => {
    setRoute({ type: "composer" })
  }

  // ── Effects ───────────────────────────────────────────────────────────

  // Auto-close subagent inspector when the inspected sessionID is no longer
  // in the tabs list (tab was removed externally).
  createEffect(() => {
    const current = route()
    if (current.type !== "subagent") return
    if (tabs().some((item) => item.sessionID === current.sessionID)) return
    closeTab()
  })

  // Auto-close subagent-menu when all tabs have been removed.
  createEffect(() => {
    if (route().type !== "subagent-menu") return
    if (tabs().length > 0) return
    closePanel()
  })

  // Auto-close queued-menu when all queued prompts have been removed.
  createEffect(() => {
    if (route().type !== "queued-menu" || queuedPrompts().length > 0) return
    closePanel()
  })

  return {
    subagentMenuRows,
    setSubagentMenuRows,
    selected,
    tabs,
    activeTabs,
    selectedTab,
    selectedIndex,
    foregroundSubagents,
    detail,
    subagentShortcut,
    backgroundShortcut,
    queuedShortcut,
    openTab,
    closeTab,
    cycleTab,
    openSubagentMenu,
    openQueuedMenu,
    closePanel,
  }
}

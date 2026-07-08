// Footer layout
//
// Renders the footer region as a compact vertical stack:
//   1. Single-line composer or active footer body
//   2. Optional autocomplete/menu panels below the composer
//   3. A statusline-style footer row carrying state, hints, and model info
//
// All state comes from the parent RunFooter through SolidJS signals.
// The view itself is stateless except for derived memos.
/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import "opentui-spinner/solid"
import { createColors, createFrames } from "@opencode-ai/tui/ui/spinner"
import {
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSkillSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody } from "./footer.subagent"
import { createPanelAutoClose } from "./footer.panel"
import { createSubagentTabState } from "./footer.subagent-tab"
import { RunPromptBody, createPromptState } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunQuestionBody } from "./footer.question"
import { footerWidthPolicy } from "./footer.width"
import {
  formatKeyBindings,
  formatKeySequence,
  useKeymapSelector,
  type OpenTuiKeymap,
} from "@opencode-ai/tui/keymap"
import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
  FooterState,
  FooterSubagentState,
  FooterView,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunCommand,
  RunDiffStyle,
  RunInput,
  RunPrompt,
  RunProvider,
  RunResource,
  RunTuiConfig,
} from "./types"
import type { RunTheme } from "./theme"
import { modelInfo } from "./variant.shared"

const EMPTY_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

type RunFooterViewProps = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: () => RunAgent[]
  resources: () => RunResource[]
  commands: () => RunCommand[] | undefined
  providers: () => RunProvider[] | undefined
  currentModel: () => RunInput["model"]
  currentSubagentModel: () => RunInput["model"]
  variants: () => string[]
  currentVariant: () => string | undefined
  state: () => FooterState
  view?: () => FooterView
  subagent?: () => FooterSubagentState
  queuedPrompts?: () => FooterQueuedPrompt[]
  theme: () => RunTheme
  diffStyle?: RunDiffStyle
  tuiConfig: RunTuiConfig
  backgroundSubagents: boolean
  history?: RunPrompt[]
  agent: string
  onSubmit: (input: RunPrompt) => boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onBackground?: () => void
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onSubagentModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onSubagentModelClear: () => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; autocomplete: boolean; subagentRows: number }) => void
  onStatus: (text: string) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  onQueuedRemove: (messageID: string) => Promise<boolean>
}

export { TEXTAREA_MIN_ROWS, TEXTAREA_MAX_ROWS } from "./footer.prompt"

export function RunFooterView(props: RunFooterViewProps) {
  const term = useTerminalDimensions()
  const width = createMemo(() => term().width)
  const responsive = createMemo(() => footerWidthPolicy(width()))
  const active = createMemo<FooterView>(() => props.view?.() ?? { type: "prompt" })
  const subagent = createMemo<FooterSubagentState>(() => {
    return (
      props.subagent?.() ?? {
        tabs: [],
        details: {},
        permissions: [],
        questions: [],
      }
    )
  })
  const [route, setRoute] = createSignal<FooterPromptRoute>({ type: "composer" })
  const queuedPrompts = createMemo(() => props.queuedPrompts?.() ?? [])
  const tabState = createSubagentTabState({
    subagent,
    queuedPrompts,
    route,
    setRoute,
    onSubagentSelect: props.onSubagentSelect,
    tuiConfig: props.tuiConfig,
    backgroundSubagents: props.backgroundSubagents,
  })
  const {
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
    cycleTab,
    openSubagentMenu,
    openQueuedMenu,
    closePanel,
  } = tabState
  const tabOpenTab = tabState.openTab
  const tabCloseTab = tabState.closeTab
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  const prompt = createMemo(() => active().type === "prompt" && route().type === "composer")
  // Tracks the status of the currently viewed subagent tab at the time it was last
  // opened by the user. The auto-close effect uses this to distinguish a deliberate
  // selection of an already-completed tab from a running→completed transition that
  // should auto-dismiss the inspector.
  let openTabStatus: string | undefined
  const openTab = (sessionID: string) => {
    const tab = tabs().find((item) => item.sessionID === sessionID)
    openTabStatus = tab?.status
    tabOpenTab(sessionID)
  }
  const closeTab = () => {
    openTabStatus = undefined
    tabCloseTab()
  }

  const selectingSubagent = createMemo(() => active().type === "prompt" && route().type === "subagent-menu")
  const selectingQueued = createMemo(() => active().type === "prompt" && route().type === "queued-menu")
  const inspecting = createMemo(() => active().type === "prompt" && route().type === "subagent")
  const commanding = createMemo(() => active().type === "prompt" && route().type === "command")
  const skilling = createMemo(() => active().type === "prompt" && route().type === "skill")
  const modeling = createMemo(() => active().type === "prompt" && route().type === "model")
  const subagentModeling = createMemo(() => active().type === "prompt" && route().type === "subagent-model")
  const varianting = createMemo(() => active().type === "prompt" && route().type === "variant")
  const panel = createMemo(
    () =>
      active().type === "permission" ||
      active().type === "question" ||
      selectingQueued() ||
      selectingSubagent() ||
      commanding() ||
      skilling() ||
      modeling() ||
      subagentModeling() ||
      varianting(),
  )
  const model = createMemo(() => {
    const current = props.currentModel()
    return current ? modelInfo(props.providers(), current) : { model: props.state().model, provider: undefined }
  })
  const command = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["command.palette.show"] })
          .get("command.palette.show")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",    )
  const interrupt = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.interrupt"] })
          .get("session.interrupt")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const variantCycle = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap.getCommandBindings({ visibility: "registered", commands: ["variant.cycle"] }).get("variant.cycle"),
        props.tuiConfig,
      ) ?? "",
  )
  const clearShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap.getCommandBindings({ visibility: "registered", commands: ["prompt.clear"] }).get("prompt.clear")?.[0]
          ?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const busy = createMemo(() => props.state().phase === "running")
  const armed = createMemo(() => props.state().interrupt > 0)
  const exiting = createMemo(() => props.state().exit > 0)
  const queue = createMemo(() => props.state().queue)
  const usage = createMemo(() => props.state().usage)
  const interruptLabel = createMemo(() => {
    if (!interrupt()) {
      return
    }

    return interrupt() === "escape" ? "esc" : interrupt()
  })
  const runTheme = createMemo(() => props.theme())
  const theme = createMemo(() => runTheme().footer)
  const block = createMemo(() => runTheme().block)
  const spin = createMemo(() => {
    return {
      frames: createFrames({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
    }
  })
  const permission = createMemo<Extract<FooterView, { type: "permission" }> | undefined>(() => {
    const view = active()
    return view.type === "permission" ? view : undefined
  })
  const question = createMemo<Extract<FooterView, { type: "question" }> | undefined>(() => {
    const view = active()
    return view.type === "question" ? view : undefined
  })
  const promptView = createMemo(() => {
    if (active().type !== "prompt") {
      return active().type
    }

    const current = route()
    return current.type === "composer" ? "prompt" : current.type
  })

  const openCommand = () => {
    setRoute({ type: "command" })
    props.onSubagentSelect?.(undefined)
  }

  const openModel = () => {
    setRoute({ type: "model" })
    props.onSubagentSelect?.(undefined)
  }

  const openSubagentModel = () => {
    setRoute({ type: "subagent-model" })
    props.onSubagentSelect?.(undefined)
  }

  const openSkillMenu = () => {
    if (props.commands() && skills().length === 0) {
      return
    }

    setRoute({ type: "skill" })
    props.onSubagentSelect?.(undefined)
  }

  const openVariant = () => {
    setRoute({ type: "variant" })
    props.onSubagentSelect?.(undefined)
  }

  const composer = createPromptState({
    directory: props.directory,
    findFiles: props.findFiles,
    agents: props.agents,
    resources: props.resources,
    commands: props.commands,
    tuiConfig: props.tuiConfig,
    state: props.state,
    view: promptView,
    prompt,
    width,
    theme,
    history: props.history,
    onSubmit: props.onSubmit,
    onCycle: props.onCycle,
    onInterrupt: props.onInterrupt,
    onEditorOpen: props.onEditorOpen,
    onInputClear: props.onInputClear,
    onExitRequest: props.onExitRequest,
    onExit: props.onExit,
    onSkillMenu: openSkillMenu,
    onModel: openModel,
    onSubagentModel: openSubagentModel,
    onSubagentModelSelect: props.onSubagentModelSelect,
    onSubagentModelClear: props.onSubagentModelClear,
    onRows: props.onRows,
    onStatus: props.onStatus,
  })
  const shell = createMemo(() => prompt() && composer.shell())
  const menu = createMemo(() => prompt() && composer.visible())
  const stateStatus = createMemo(() => props.state().status.trim())
  const modeLabel = createMemo(() => {
    if (exiting()) {
      return "EXIT"
    }

    return shell() ? "SHELL" : "BUILD"
  })
  const modeColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (shell()) {
      return theme().warning
    }

    return theme().highlight
  })
  const statusText = createMemo(() => {
    if (exiting()) {
      return `Press ${clearShortcut() || "ctrl+c"} again to exit`
    }

    if (busy()) {
      return armed() ? "again to interrupt" : "interrupt"
    }

    if (stateStatus().length > 0) {
      return stateStatus()
    }

    return shell() ? "Shell mode" : ""
  })
  const activityMeta = createMemo(() => {
    if (!responsive().statusline.showActivityMeta || usage().length === 0) {
      return ""
    }

    return usage()
  })
  const modelStatus = createMemo(() => {
    const current = props.currentModel()
    if (!prompt() || shell() || !current) {
      return
    }

    return {
      model: model().model,
      variant: props.currentVariant(),
      provider: undefined,
      // Prefer without provider, but keep it on the shared width policy if we add it back.
    }
  })
  const statusColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (armed()) {
      return theme().highlight
    }

    if (busy() || stateStatus().length > 0) {
      return theme().text
    }

    return theme().muted
  })
  const statuslineBackground = createMemo(() => theme().status)
  const hasActivityMeta = createMemo(() => activityMeta().length > 0)
  const hasModelStatus = createMemo(() => responsive().statusline.showModel && Boolean(modelStatus()))
  const contextHints = createMemo(() => {
    if (!prompt() || shell() || !responsive().statusline.showContextHints) {
      return []
    }

    const items: Array<{ kind: string; key: string; label: string }> = []
    if (foregroundSubagents() && backgroundShortcut()) {
      items.push({ kind: "background", key: backgroundShortcut(), label: "background" })
    }
    if (queuedPrompts().length > 0 && queuedShortcut()) {
      items.push({ kind: "queued", key: queuedShortcut(), label: `${queue()} queued` })
    }
    if (tabs().length > 0 && subagentShortcut() && activeTabs().length > 0) {
      items.push({ kind: "subagents", key: subagentShortcut(), label: "subagents" })
    }

    const limit = responsive().statusline.contextHintLimit
    return limit === undefined ? items : items.slice(0, limit)
  })
  const hasContextHints = createMemo(() => contextHints().length > 0)
  const commandHint = createMemo(() => {
    if (!prompt() || !responsive().statusline.showCommandHint) {
      return
    }

    if (shell()) {
      return { key: "esc", label: "normal" }
    }

    if (command()) {
      return { key: command(), label: "cmd" }
    }
  })
  const sectionSeparator = () => <span style={{ fg: theme().muted }}>· </span>

  createEffect(() => {
    props.onRequestExit?.(composer.requestExit)
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && !composer.visible(),
    commands: [
      {
        name: "command.palette.show",
        title: "Open command palette",
        category: "Prompt",
        run: openCommand,
      },
      {
        name: "variant.cycle",
        title: "Cycle model variant",
        category: "Model",
        run: props.onCycle,
      },
    ],
    bindings: [
      ...props.tuiConfig.keybinds.get("command.palette.show"),
      ...props.tuiConfig.keybinds.get("variant.cycle"),
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
        run: () => props.onBackground?.(),
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.background"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && tabs().length > 0,
    commands: [
      {
        name: "session.child.first",
        title: "View subagents",
        category: "Session",
        run: openSubagentMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.child.first"),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && queuedPrompts().length > 0,
    commands: [
      {
        name: "session.queued_prompts",
        title: "Manage queued prompts",
        category: "Session",
        run: openQueuedMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.queued_prompts"),
  }))

  createEffect(() => {
    const current = route()
    if (current.type !== "subagent") {
      return
    }

    if (tabs().some((item) => item.sessionID === current.sessionID)) {
      return
    }

    closeTab()
  })

  // Auto-close subagent tab when the currently inspected subagent finishes.
  // This returns focus to the composer so the user can type immediately
  // without having to manually press Escape to dismiss the subagent view.
  // Does NOT close if the user deliberately selected an already-completed tab
  // (openTabStatus already reflects the terminal status at selection time).
  createEffect(() => {
    const current = route()
    if (current.type !== "subagent") return
    const tab = tabs().find((item) => item.sessionID === current.sessionID)
    if (!tab) return
    // If the tab was already in a terminal status when the user selected it,
    // they deliberately chose to view a completed subagent — keep it open.
    const wasTerminalOnOpen =
      openTabStatus === "completed" || openTabStatus === "cancelled" || openTabStatus === "error"
    if (wasTerminalOnOpen) return
    if (tab.status === "completed" || tab.status === "cancelled" || tab.status === "error") {
      closeTab()
    }
  })

  createEffect(() => {
    if (route().type !== "subagent-menu") {
      return
    }

    if (tabs().length > 0) {
      return
    }

    closePanel()
  })

  createEffect(() => {
    if (route().type !== "queued-menu" || queuedPrompts().length > 0) return
    closePanel()
  })

  createEffect(() => {
    if (active().type === "prompt") {
      return
    }

    const current = route()
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

    closePanel()
  })

  createEffect(() => {
    props.onLayout({
      route: route(),
      autocomplete: menu(),
      subagentRows: subagentMenuRows(),
    })
  })

  return (
    <box
      id="run-direct-footer-shell"
      width="100%"
      height="100%"
      border={false}
      backgroundColor="transparent"
      flexDirection="column"
      gap={0}
      padding={0}
    >
      <Show when={panel() || inspecting()}>
        <box id="run-direct-footer-panel-spacer" width="100%" height={1} flexShrink={0} backgroundColor="transparent" />
      </Show>

      <Show
        when={inspecting()}
        fallback={
          <box width="100%" flexDirection="column" gap={0}>
            <For each={[promptView()]}>
              {() => (
                <box
                  id="run-direct-footer-composer-frame"
                  width="100%"
                  flexShrink={0}
                  border={panel() || prompt() ? false : ["left"]}
                  borderColor={panel() || prompt() ? undefined : theme().highlight}
                  customBorderChars={
                    panel() || prompt()
                      ? undefined
                      : {
                          ...EMPTY_BORDER,
                          vertical: "█",
                        }
                  }
                >
                  <box
                    id="run-direct-footer-composer-area"
                    width="100%"
                    flexGrow={1}
                    paddingLeft={0}
                    paddingRight={0}
                    paddingTop={0}
                    flexDirection="column"
                    backgroundColor={panel() || prompt() ? "transparent" : theme().surface}
                    gap={0}
                  >
                    <box id="run-direct-footer-body" width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
                      <Switch>
                        <Match when={active().type === "prompt" && route().type === "composer"}>
                          <RunPromptBody
                            theme={theme}
                            background={() => runTheme().background}
                            placeholder={composer.placeholder}
                            onSubmit={composer.onSubmit}
                            onKeyDown={composer.onKeyDown}
                            onContentChange={composer.onContentChange}
                            bind={composer.bind}
                          />
                        </Match>
                        <Match when={selectingSubagent()}>
                          <RunSubagentSelectBody
                            theme={theme}
                            tabs={tabs}
                            current={selected}
                            onClose={closePanel}
                            onSelect={openTab}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={selectingQueued()}>
                          <RunQueuedPromptSelectBody
                            theme={theme}
                            prompts={queuedPrompts}
                            onClose={closePanel}
                            onDelete={(item) => void props.onQueuedRemove(item.messageID)}
                            onEdit={async (item) => {
                              if (!(await props.onQueuedRemove(item.messageID))) return
                              closePanel()
                              queueMicrotask(() => composer.replacePrompt(item.prompt))
                            }}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={commanding()}>
                          <RunCommandMenuBody
                            theme={theme}
                            commands={props.commands}
                            subagents={tabs}
                            queued={queuedPrompts}
                            variants={props.variants}
                            variantCycle={variantCycle()}
                            onClose={closePanel}
                            onModel={openModel}
                            onSubagentModel={openSubagentModel}
                            onEditor={() => {
                              closePanel()
                              void composer.openEditor()
                            }}
                            onSkill={openSkillMenu}
                            onSubagent={openSubagentMenu}
                            onQueued={openQueuedMenu}
                            onVariant={openVariant}
                            onVariantCycle={() => {
                              props.onCycle()
                              closePanel()
                            }}
                            onCommand={(name) => {
                              if (name === "subagent" || name === "subagents") {
                                openSubagentModel()
                                return
                              }
                              composer.submitText(`/${name}`)
                              closePanel()
                            }}
                            onNew={() => {
                              composer.submitText("/new")
                              closePanel()
                            }}
                            onExit={props.onExit}
                          />
                        </Match>
                        <Match when={skilling()}>
                          <RunSkillSelectBody
                            theme={theme}
                            commands={props.commands}
                            onClose={closePanel}
                            onSelect={(name) => {
                              composer.replacePrompt({
                                text: `/${name} `,
                                parts: [],
                                command: {
                                  name,
                                  arguments: "",
                                },
                              })
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={modeling()}>
                          <RunModelSelectBody
                            theme={theme}
                            providers={props.providers}
                            current={props.currentModel}
                            onClose={closePanel}
                            onSelect={(model) => {
                              props.onModelSelect(model)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={subagentModeling()}>
                          <RunModelSelectBody
                            theme={theme}
                            providers={props.providers}
                            current={props.currentSubagentModel}
                            onClose={closePanel}
                            title="Select subagent model"
                            onSelect={(model) => {
                              props.onSubagentModelSelect(model)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={varianting()}>
                          <RunVariantSelectBody
                            theme={theme}
                            variants={props.variants}
                            current={props.currentVariant}
                            onClose={closePanel}
                            onSelect={(variant) => {
                              props.onVariantSelect(variant)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={active().type === "permission"}>
                          <RunPermissionBody
                            request={permission()!.request}
                            theme={theme()}
                            block={block()}
                            diffStyle={props.diffStyle}
                            onReply={props.onPermissionReply}
                          />
                        </Match>
                        <Match when={active().type === "question"}>
                          <RunQuestionBody
                            request={question()!.request}
                            theme={theme()}
                            onReply={props.onQuestionReply}
                            onReject={props.onQuestionReject}
                          />
                        </Match>
                      </Switch>
                    </box>
                  </box>
                </box>
              )}
            </For>

            <Show when={!panel() && menu()}>
              <RunFooterMenu
                id="run-direct-footer-complete"
                theme={theme}
                items={composer.options}
                selected={composer.selected}
                offset={composer.offset}
                rows={composer.rows}
                limit={FOOTER_MENU_ROWS}
                border={false}
                paddingLeft={0}
              />
            </Show>

            <Show when={!panel() && !menu()}>
              <box
                id="run-direct-footer-statusline"
                width="100%"
                height={1}
                flexDirection="row"
                gap={0}
                flexShrink={0}
                backgroundColor={statuslineBackground()}
              >
                <box
                  id="run-direct-footer-statusline-mode"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={theme().statusAccent}
                  flexShrink={0}
                >
                  <text wrapMode="none" truncate>
                    <span style={{ fg: modeColor(), bold: true }}>{modeLabel()}</span>
                  </text>
                </box>

                <box
                  id="run-direct-footer-statusline-main"
                  flexDirection="row"
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={12}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor="transparent"
                >
                  <Show when={busy() && !exiting()}>
                    <box id="run-direct-footer-status-spinner" flexShrink={0}>
                      <spinner color={spin().color} frames={spin().frames} interval={40} />
                    </box>
                  </Show>

                  <text
                    id="run-direct-footer-statusline-text"
                    fg={statusColor()}
                    wrapMode="none"
                    truncate
                    flexGrow={1}
                    flexShrink={1}
                  >
                    <Show when={busy() && !exiting()} fallback={statusText()}>
                      <Show when={interruptLabel()}>
                        {(label) => <span style={{ fg: armed() ? statusColor() : theme().muted }}>{label()} </span>}
                      </Show>
                      {statusText()}
                    </Show>
                  </text>
                </box>

                <Show when={activityMeta().length > 0}>
                  <box
                    id="run-direct-footer-statusline-meta"
                    paddingRight={1}
                    backgroundColor="transparent"
                    flexShrink={1}
                  >
                    <text fg={theme().muted} wrapMode="none" truncate>
                      {activityMeta()}
                    </text>
                  </box>
                </Show>

                <Show when={responsive().statusline.showModel && modelStatus()}>
                  {(info) => (
                    <box
                      id="run-direct-footer-statusline-model"
                      paddingRight={1}
                      backgroundColor="transparent"
                      flexShrink={0}
                    >
                      <text fg={theme().text} wrapMode="none">
                        {info().model}
                        <Show when={info().provider}>
                          {(provider) => <span style={{ fg: theme().muted }}> {provider()}</span>}
                        </Show>
                        <Show when={info().variant}>
                          {(variant) => (
                            <>
                              <span style={{ fg: theme().warning, bold: true }}> {variant()}</span>
                            </>
                          )}
                        </Show>
                      </text>
                    </box>
                  )}
                </Show>

                <For each={contextHints()}>
                  {(hint, index) => (
                    <box
                      id={`run-direct-footer-statusline-${hint.kind}`}
                      paddingRight={1}
                      backgroundColor="transparent"
                      flexShrink={0}
                      maxWidth={24}
                    >
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={index() > 0 || ((hasActivityMeta() || hasModelStatus()) && index() === 0)}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint.key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint.label}</span>
                      </text>
                    </box>
                  )}
                </For>

                <Show when={commandHint()}>
                  {(hint) => (
                    <box
                      id="run-direct-footer-statusline-hint"
                      paddingRight={1}
                      backgroundColor="transparent"
                      flexShrink={0}
                      maxWidth={18}
                    >
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={hasActivityMeta() || hasModelStatus() || hasContextHints()}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint().key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint().label}</span>
                      </text>
                    </box>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        }
      >
        <box
          id="run-direct-footer-subagent-frame"
          width="100%"
          flexGrow={1}
          flexShrink={1}
          border={["left"]}
          borderColor={theme().highlight}
          customBorderChars={{
            ...EMPTY_BORDER,
            vertical: "┃",
          }}
        >
          <RunFooterSubagentBody
            active={inspecting}
            theme={runTheme}
            tab={selectedTab}
            index={selectedIndex}
            total={() => tabs().length}
            detail={detail}
            width={width}
            diffStyle={props.diffStyle}
            onCycle={cycleTab}
            onClose={closeTab}
          />
        </box>
      </Show>
    </box>
  )
}

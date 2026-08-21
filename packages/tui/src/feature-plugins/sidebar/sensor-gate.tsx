import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, createEffect } from "solid-js"

const id = "internal:sidebar-sensor-gate"

function View(props: { api: TuiPluginApi }) {
  // Start in loading state (null), sync from server on mount
  const [enabled, setEnabled] = createSignal<boolean | null>(null)
  const theme = () => props.api.theme.current

  // Get the underlying hey-api Client from the typed OpencodeClient.
  // OpencodeClient doesn't expose generic .get()/.post(), but the
  // protected `this.client` property (from HeyApiClient) does.
  // We access it via `as any` since protected access is a
  // TS-only restriction — at runtime it works in both webview TUI
  // and compiled binary contexts.
  const httpClient = (props.api.client as any).client

  // Sync toggle state from server on component mount.
  // Uses the internal hey-api client which knows the correct base URL
  // and has proper interceptor setup (directory headers, etc.).
  createEffect(() => {
    if (enabled() === null) {
      httpClient
        .get({ url: "/experimental/sensor-gate" })
        .then((resp: any) => setEnabled(resp.enabled === true))
        .catch(() => setEnabled(true))
    }
  })

  const toggle = () => {
    const next = !enabled()
    // Optimistic UI update
    setEnabled(next)
    // Persist to server via the internal client (knows the base URL)
    httpClient
      .post({ url: "/experimental/sensor-gate", body: { enabled: next } })
      .catch((err: any) => {
        console.warn("[sensor-gate] toggle POST failed:", err)
        setEnabled(!next)
      })
  }

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text}>
          <b>SENSOR GATE</b>
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        {/* ON button — always rounded border, color indicates active */}
        <box
          backgroundColor={enabled() ? theme().success : theme().backgroundElement}
          borderStyle={"rounded"}
          borderColor={enabled() ? theme().success : theme().backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => { if (!enabled()) toggle() }}
        >
          <text fg={enabled() ? theme().background : theme().textMuted}>
            <b>ON</b>
          </text>
        </box>
        {/* OFF button — always rounded border, color indicates active */}
        <box
          backgroundColor={!enabled() ? theme().warning : theme().backgroundElement}
          borderStyle={"rounded"}
          borderColor={!enabled() ? theme().warning : theme().backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => { if (enabled()) toggle() }}
        >
          <text fg={!enabled() ? theme().background : theme().textMuted}>
            <b>OFF</b>
          </text>
        </box>
        <text fg={theme().textMuted}>
          {enabled() === null
            ? "Loading..."
            : enabled()
              ? "Sensor gate active"
              : "Gate disabled"}
        </text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

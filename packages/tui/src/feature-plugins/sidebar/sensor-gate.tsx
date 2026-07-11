import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal } from "solid-js"

const id = "internal:sidebar-sensor-gate"

function View(props: { api: TuiPluginApi }) {
  const [enabled, setEnabled] = createSignal(true)
  const theme = () => props.api.theme.current

  const toggle = () => {
    const next = !enabled()
    setEnabled(next)
    // Call the server endpoint to toggle sensor gate globally
    props.api.client
      .post({ url: "/experimental/sensor-gate", body: { enabled: next } })
      .catch((err) => console.warn("[sensor-gate] toggle POST failed:", err))
  }

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text}>
          <b>SENSOR GATE</b>
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <box
          backgroundColor={enabled() ? theme().success : theme().backgroundElement}
          borderStyle={enabled() ? "round" : "none"}
          borderColor={enabled() ? theme().success : undefined}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => { if (!enabled()) toggle() }}
        >
          <text bold fg={enabled() ? theme().background : theme().textMuted}>
            ON
          </text>
        </box>
        <box
          backgroundColor={!enabled() ? theme().warning : theme().backgroundElement}
          borderStyle={!enabled() ? "round" : "none"}
          borderColor={!enabled() ? theme().warning : undefined}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => { if (enabled()) toggle() }}
        >
          <text bold fg={!enabled() ? theme().background : theme().textMuted}>
            OFF
          </text>
        </box>
        <text fg={theme().textMuted}>
          {enabled() ? "Sensor gate active" : "Gate disabled, skills still load"}
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

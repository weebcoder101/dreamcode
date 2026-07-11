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
      .catch(() => {})
  }

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text}>
          <b>SENSOR GATE</b>
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text
          clickable
          onPointerDown={toggle}
          cursor="pointer"
          style={{ fg: enabled() ? theme().success : theme().warning, bold: true }}
        >
          {enabled() ? "ON" : "OFF"}
        </text>
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

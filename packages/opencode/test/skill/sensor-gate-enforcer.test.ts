import { describe, expect, test } from "bun:test"
import { SensorGateEnforcerPlugin } from "@/skill/sensor-gate-enforcer"

describe("SensorGateEnforcerPlugin", () => {
  test("returns a plugin instance (async function)", () => {
    const instance = SensorGateEnforcerPlugin({} as any)
    expect(typeof instance).toBe("function")
  })

  test("plugin instance returns a hooks object", async () => {
    const instance = SensorGateEnforcerPlugin({} as any)
    const hooks = await instance()
    expect(hooks).toBeDefined()
    expect(typeof hooks).toBe("object")
    expect(hooks).toHaveProperty(["chat.message"])
    expect(hooks).toHaveProperty(["experimental.chat.system.transform"])
    expect(typeof hooks["chat.message"]).toBe("function")
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function")
  })

  test("chat.message handler skips on empty prompt", async () => {
    const instance = SensorGateEnforcerPlugin({} as any)
    const hooks = await instance()
    // Should not throw when given an empty prompt
    const chatMessage = hooks["chat.message"]!
    await expect(
      chatMessage(
        { client: { directory: "/tmp" }, sessionID: "test-1" } as any,
        { parts: [] } as any,
      ),
    ).resolves.toBeUndefined()

    await expect(
      chatMessage(
        { client: { directory: "/tmp" }, sessionID: "test-1" } as any,
        { parts: [{ type: "text", text: "   " }] } as any,
      ),
    ).resolves.toBeUndefined()
  })

  test("transform handler does not throw when no session state exists", async () => {
    const instance = SensorGateEnforcerPlugin({} as any)
    const hooks = await instance()
    const transform = hooks["experimental.chat.system.transform"]!
    await expect(
      transform(
        { client: { directory: "/tmp" }, sessionID: "nonexistent" } as any,
        { system: "" } as any,
      ),
    ).resolves.toBeUndefined()
  })
})

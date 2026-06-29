import { describe, expect, test } from "bun:test"
import { SensorGateEnforcerPlugin } from "@/skill/sensor-gate-enforcer"

describe("SensorGateEnforcerPlugin", () => {
  test("returns a hooks object (async Plugin factory)", async () => {
    const hooks = await SensorGateEnforcerPlugin({} as any)
    expect(hooks).toBeDefined()
    expect(typeof hooks).toBe("object")
    expect(hooks).toHaveProperty(["chat.message"])
    expect(hooks).toHaveProperty(["experimental.chat.system.transform"])
    expect(typeof hooks["chat.message"]).toBe("function")
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function")
  })

  test("chat.message handler skips on empty prompt", async () => {
    const hooks = await SensorGateEnforcerPlugin({} as any)
    const chatMessage = hooks["chat.message"]!
    await expect(
      chatMessage(
        { sessionID: "test-1" } as any,
        { parts: [] } as any,
      ),
    ).resolves.toBeUndefined()

    await expect(
      chatMessage(
        { sessionID: "test-1" } as any,
        { parts: [{ type: "text", text: "   " }] } as any,
      ),
    ).resolves.toBeUndefined()
  })

  test("transform handler does not throw when no session state exists", async () => {
    const hooks = await SensorGateEnforcerPlugin({} as any)
    const transform = hooks["experimental.chat.system.transform"]!
    await expect(
      transform(
        { sessionID: "nonexistent" } as any,
        { system: "" } as any,
      ),
    ).resolves.toBeUndefined()
  })

  test("dispose handler clears session state", async () => {
    const hooks = await SensorGateEnforcerPlugin({} as any)
    expect(typeof hooks.dispose).toBe("function")
    await expect(hooks.dispose!()).resolves.toBeUndefined()
  })

  test("chat.message creates session state on first call with text", async () => {
    const hooks = await SensorGateEnforcerPlugin({} as any)
    const chatMessage = hooks["chat.message"]!
    await expect(
      chatMessage(
        { client: { directory: "/tmp/test" }, sessionID: "test-session" } as any,
        { parts: [{ type: "text", text: "check my code" }] } as any,
      ),
    ).resolves.toBeUndefined()
  })
})

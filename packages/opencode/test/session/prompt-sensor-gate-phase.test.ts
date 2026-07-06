import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.resolve(__dirname, "../../src/session/prompt-sensor-gate-phase.ts")

describe("prompt-sensor-gate-phase", () => {
  test("personaAssistantMsg includes cost and tokens fields (prevents TUI crash)", () => {
    const source = readFileSync(sourcePath, "utf-8")

    // Find the personaAssistantMsg object definition
    const personaMsgMatch = source.match(/const personaAssistantMsg: any = \{[\s\S]*?\n    \}/)
    expect(personaMsgMatch).not.toBeNull()
    const msg = personaMsgMatch![0]

    // Verify cost field is present (not undefined)
    expect(msg).toContain("cost:")
    expect(msg).toMatch(/cost:\s*0/)

    // Verify tokens field is present with all required sub-fields
    expect(msg).toContain("tokens:")
    expect(msg).toContain("input:")
    expect(msg).toContain("output:")
    expect(msg).toContain("reasoning:")
    expect(msg).toContain("cache:")

    // Verify the comment explains WHY cost/tokens are needed
    expect(msg).toContain("TUI")
    expect(msg).toContain("crashes")
    expect(msg).toContain("Missing key")
  })

  test("synthesisMessage (user role) does NOT need cost/tokens", () => {
    const source = readFileSync(sourcePath, "utf-8")

    // Find the synthesisMessage object definition
    const synthMsgMatch = source.match(/const synthesisMessage: any = \{[\s\S]*?\n    \}/)
    expect(synthMsgMatch).not.toBeNull()
    const msg = synthMsgMatch![0]

    // User messages should NOT have cost/tokens (only assistant messages need them)
    // But confirm it has role: "user"
    expect(msg).toContain('role: "user"')
  })
})

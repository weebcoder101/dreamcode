import { describe, expect, test } from "bun:test"
import { resolveSavedSubagentModel, saveSubagentModel, clearSubagentModel } from "@/cli/cmd/run/variant.shared"

describe("subagent model functions", () => {
  test("exports exist with correct signatures", () => {
    expect(typeof resolveSavedSubagentModel).toBe("function")
    expect(typeof saveSubagentModel).toBe("function")
    expect(typeof clearSubagentModel).toBe("function")
  })

  test("resolveSavedSubagentModel returns undefined or a valid model object", () => {
    const result = resolveSavedSubagentModel()
    // Must be either undefined or an object with providerID and modelID
    if (result !== undefined) {
      expect(typeof result).toBe("object")
      expect(typeof (result as Record<string, string>).providerID).toBe("string")
      expect(typeof (result as Record<string, string>).modelID).toBe("string")
    }
  })
})

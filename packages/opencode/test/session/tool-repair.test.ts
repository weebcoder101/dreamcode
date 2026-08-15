import { describe, expect, test } from "bun:test"
import { repairToolInput } from "../../src/session/tool-repair"

const schema = {
  type: "object",
  required: ["path"],
  properties: {
    path: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    file_path: { type: "string" },
    oldText: { type: "string" },
    old_string: { type: "string" },
    lines: { type: "array", items: { type: "number" } },
  },
} as const

describe("tool-repair", () => {
  test("drops null optional fields", () => {
    const { args } = repairToolInput("edit", { path: "a.ts", oldText: null }, schema as any)
    expect(args).toEqual({ path: "a.ts" })
  })

  test("keeps null for required fields", () => {
    const { args } = repairToolInput("edit", { path: null }, schema as any)
    expect(args).toEqual({ path: null })
  })

  test("parses JSON-stringified arrays", () => {
    const { args, notes } = repairToolInput("edit", { files: '["a.ts","b.ts"]' }, schema as any)
    expect(args).toEqual({ files: ["a.ts", "b.ts"] })
    expect(notes.length).toBeGreaterThan(0)
  })

  test("wraps bare string as array when array expected", () => {
    const { args, notes } = repairToolInput("edit", { files: "a.ts" }, schema as any)
    expect(args).toEqual({ files: ["a.ts"] })
    expect(notes.length).toBeGreaterThan(0)
  })

  test("replaces empty object placeholder with empty array", () => {
    const { args } = repairToolInput("edit", { lines: {} }, schema as any)
    expect(args).toEqual({ lines: [] })
  })

  test("unwraps markdown auto-link on path fields", () => {
    const { args } = repairToolInput("edit", { path: "[a.ts](http://file.ts)" }, schema as any)
    expect(args).toEqual({ path: "a.ts" })
  })

  test("renames aliased fields when source is not a real schema field", () => {
    const { args } = repairToolInput("edit", { file_path: "a.ts" }, { type: "object", properties: { path: { type: "string" } } } as any)
    expect(args).toEqual({ path: "a.ts" })
  })

  test("keeps real schema field even when it collides with an alias", () => {
    const grepSchema = {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
    } as const
    const { args, notes } = repairToolInput("grep", { pattern: "def ", path: "src" }, grepSchema as any)
    expect(args).toEqual({ pattern: "def ", path: "src" })
    expect(notes).toEqual([])
  })

  test("keeps real schema field over alias when both are declared", () => {
    const { args } = repairToolInput("edit", { file_path: "a.ts" }, schema as any)
    expect(args).toEqual({ file_path: "a.ts" })
  })

  test("leaves valid calls untouched (no notes)", () => {
    const { args, notes } = repairToolInput("edit", { path: "a.ts", files: ["x.ts"] }, schema as any)
    expect(args).toEqual({ path: "a.ts", files: ["x.ts"] })
    expect(notes).toEqual([])
  })

  test("recursively repairs arrays of objects", () => {
    const nestedSchema = {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              file_path: { type: "string" },
            },
          },
        },
      },
    } as const
    const { args } = repairToolInput(
      "apply_patch",
      { blocks: [{ file_path: "a.ts" }, { path: "[b.ts](http://b.ts)" }] },
      nestedSchema as any,
    )
    expect(args).toEqual({ blocks: [{ file_path: "a.ts" }, { path: "b.ts" }] })
  })
})

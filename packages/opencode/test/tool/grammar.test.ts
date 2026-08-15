import { describe, expect, test } from "bun:test"
import { grammarForFile, parseWithGrammar, supportedExtensions } from "../../src/tool/grammar"

describe("grammar registry", () => {
  test("maps known extensions to grammars", () => {
    expect(grammarForFile("a.ts")?.id).toBe("typescript")
    expect(grammarForFile("a.tsx")?.id).toBe("tsx")
    expect(grammarForFile("a.py")?.id).toBe("python")
    expect(grammarForFile("a.rs")?.id).toBe("rust")
    expect(grammarForFile("a.go")?.id).toBe("go")
    expect(grammarForFile("a.sh")?.id).toBe("bash")
    expect(grammarForFile("a.unknown_ext")?.id).toBeUndefined()
  })

  test("supportedExtensions is non-empty and includes core languages", () => {
    const exts = supportedExtensions()
    expect(exts.length).toBeGreaterThan(20)
    expect(exts).toContain(".ts")
    expect(exts).toContain(".py")
    expect(exts).toContain(".rs")
  })

  test("parses TypeScript source", async () => {
    const parsed = await parseWithGrammar("a.ts", "export function add(a: number, b: number): number { return a + b }")
    expect(parsed).toBeDefined()
    expect(parsed!.tree!.rootNode.type).toBe("program")
    expect(parsed!.tree!.rootNode.hasError).toBe(false)
  })

  test("parses Python source", async () => {
    const parsed = await parseWithGrammar("a.py", "def add(a, b):\n    return a + b\n")
    expect(parsed).toBeDefined()
    expect(parsed!.tree!.rootNode.hasError).toBe(false)
  })

  test("parses Rust source", async () => {
    const parsed = await parseWithGrammar("a.rs", "fn add(a: i32, b: i32) -> i32 { a + b }\n")
    expect(parsed).toBeDefined()
    expect(parsed!.tree!.rootNode.hasError).toBe(false)
  })

  test("lazy-loads distinct grammars without interference", async () => {
    const [ts, py] = await Promise.all([
      parseWithGrammar("a.ts", "const x: number = 1"),
      parseWithGrammar("a.py", "x = 1"),
    ])
    expect(ts).toBeDefined()
    expect(py).toBeDefined()
  })
})

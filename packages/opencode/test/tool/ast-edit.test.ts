import { describe, expect, test } from "bun:test"
import { parseWithGrammar } from "../../src/tool/grammar"

async function applyEdits(filePath: string, source: string, ops: { start: number; end: number; text: string }[]) {
  const sorted = [...ops].sort((a, b) => b.start - a.start)
  let next = source
  for (const edit of sorted) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  }
  return next
}

async function findNodes(filePath: string, source: string, kind: string) {
  const parsed = await parseWithGrammar(filePath, source)
  expect(parsed).toBeDefined()
  const tree = parsed!.tree!
  const out: any[] = []
  const walk = (node: any) => {
    if (!node) return
    if (node.type === kind) out.push(node)
    for (const child of node.namedChildren ?? []) walk(child)
  }
  walk(tree.rootNode as any)
  return out
}

describe("ast-edit mechanics (byte-range, indentation-proof)", () => {
  test("byte-range replacement preserves surrounding indentation", async () => {
    const source = "function main() {\n    const x = 1\n    return x\n}\n"
    const identifiers = await findNodes("a.ts", source, "identifier")
    const x = identifiers.find((n) => n.text === "x")
    expect(x).toBeDefined()
    expect(x).toBeDefined()
    const xn = x!
    const next = await applyEdits("a.ts", source, [{ start: xn.startIndex, end: xn.endIndex, text: "y" }])
    // Only the targeted byte range changes; the other occurrence stays intact
    expect(next).toBe("function main() {\n    const y = 1\n    return x\n}\n")
    const reparsed = await parseWithGrammar("a.ts", next)
    expect(reparsed!.tree!.rootNode.hasError).toBe(false)
  })

  test("renameSymbol-style multi-edit: both occurrences replaced", async () => {
    const source = "function add(a: number, b: number): number {\n  return a + b\n}\n"
    const identifiers = await findNodes("a.ts", source, "identifier")
    const edits = identifiers
      .filter((n) => n.text === "a" || n.text === "b")
      .map((n) => ({ start: n.startIndex, end: n.endIndex, text: "v" }))
    const next = await applyEdits("a.ts", source, edits)
    expect(next).toBe("function add(v: number, v: number): number {\n  return v + v\n}\n")
  })

  test("Python function-body node spans exact byte range", async () => {
    const source = "def foo():\n    print('hi')\n    print('bye')\n"
    const funcs = await findNodes("a.py", source, "function_definition")
    expect(funcs.length).toBe(1)
    const f = funcs[0]
    expect(source.slice(f.startIndex, f.endIndex)).toBe("def foo():\n    print('hi')\n    print('bye')")
    const next = await applyEdits("a.py", source, [{ start: f.startIndex, end: f.endIndex, text: "def foo():\n    pass" }])
    const reparsed = await parseWithGrammar("a.py", next)
    expect(reparsed!.tree!.rootNode.hasError).toBe(false)
    expect(next).toBe("def foo():\n    pass\n")
  })

  test("deleteBlock-style: removing an if-block leaves valid syntax", async () => {
    const source = "function f() {\n  if (x) {\n    doThing()\n  }\n  return 1\n}\n"
    const blocks = await findNodes("a.ts", source, "if_statement")
    expect(blocks.length).toBe(1)
    const b = blocks[0]
    const next = await applyEdits("a.ts", source, [{ start: b.startIndex, end: b.endIndex, text: "" }])
    const reparsed = await parseWithGrammar("a.ts", next)
    expect(reparsed!.tree!.rootNode.hasError).toBe(false)
    expect(next).toContain("return 1")
  })
})

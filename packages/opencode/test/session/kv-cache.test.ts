import { test, expect } from "bun:test"
import { buildSystemPrompt } from "../../src/session/prompt-utils"

const base = {
  env: ["<env>Working directory: /x</env>", "Today's date: Mon Aug 17 2026"],
  instructions: ["# Instructions\n- rule 1"],
  skills: "<skills>manifest</skills>",
  knowledge: "<learned-knowledge>rules</learned-knowledge>",
  selfCheck: "# Self-Check Protocol",
}

test("identical inputs produce a byte-identical system prompt", () => {
  expect(buildSystemPrompt(base).join("\n")).toBe(buildSystemPrompt(base).join("\n"))
})

test("taste mutation only alters the tail element (prefix byte-identical)", () => {
  const a = buildSystemPrompt({ ...base, taste: "<taste-profile>A</taste-profile>" })
  const b = buildSystemPrompt({ ...base, taste: "<taste-profile>B</taste-profile>" })
  // Static prefix = [env(no-date), DREAM, instructions, skills, selfCheck]
  // Dynamic tail = [knowledge, date, taste]
  expect(a.slice(0, -1)).toEqual(b.slice(0, -1))
  expect(a[a.length - 1]).toBe("<taste-profile>A</taste-profile>")
  expect(b[b.length - 1]).toBe("<taste-profile>B</taste-profile>")
})

test("date change only alters the tail region (static prefix byte-identical)", () => {
  const a = buildSystemPrompt({ ...base, env: ["<env>d</env>", "Today's date: Mon Aug 17 2026"] })
  const b = buildSystemPrompt({ ...base, env: ["<env>d</env>", "Today's date: Tue Aug 18 2026"] })
  // Tail = [knowledge, date, taste] — last 2 change, prefix up to knowledge is stable
  expect(a.slice(0, a.length - 2)).toEqual(b.slice(0, b.length - 2))
})

test("knowledge mutation only alters the tail region (static prefix byte-identical)", () => {
  const a = buildSystemPrompt({ ...base, knowledge: "<learned-knowledge>old</learned-knowledge>" })
  const b = buildSystemPrompt({ ...base, knowledge: "<learned-knowledge>new rules</learned-knowledge>" })
  // Static prefix = [env(no-date), DREAM, instructions, skills, selfCheck]
  // Dynamic tail = [knowledge, date, taste]
  expect(a.slice(0, -3)).toEqual(b.slice(0, -3))
})

test("missing taste/skills/knowledge does not shift the static prefix", () => {
  const withAll = buildSystemPrompt({ ...base, taste: "<taste-profile>T</taste-profile>" })
  const without = buildSystemPrompt({ ...base })
  expect(withAll.slice(0, -1)).toEqual(without)
})

test("static-prefix ordering is enforced (KV-cache discipline)", () => {
  const s = buildSystemPrompt({ ...base, taste: "<taste-profile>T</taste-profile>" })
  const joined = s.join("\n")
  const idxEnv = joined.indexOf("<env>")
  const idxDream = joined.indexOf("Dream Protocol")
  const idxSelf = joined.indexOf("Self-Check Protocol")
  const idxKnowledge = joined.indexOf("<learned-knowledge>")
  const idxDate = joined.indexOf("Today's date:")
  const idxTaste = joined.indexOf("<taste-profile>")
  // Static: env < dream < selfCheck
  expect(idxDream).toBeGreaterThan(idxEnv)
  expect(idxSelf).toBeGreaterThan(idxDream)
  // Dynamic tail: selfCheck < knowledge < date < taste
  expect(idxKnowledge).toBeGreaterThan(idxSelf)
  expect(idxDate).toBeGreaterThan(idxKnowledge)
  expect(idxTaste).toBeGreaterThan(idxDate)
})

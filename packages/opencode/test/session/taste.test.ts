import { test, expect } from "bun:test"
import {
  extractExplicitPreferences,
  accumulate,
  fitBudget,
  fmtSection,
  hash,
} from "../../src/session/prompt-taste"
import type { TasteEvent } from "../../src/session/prompt-taste"

const day = 24 * 60 * 60 * 1000

function ev(ts: number, type: TasteEvent["type"], context: string, confidence = 1.0): TasteEvent {
  return { ts, sessionID: "s", type, raw: context, confidence, context }
}

test("junk explicit preferences are filtered", () => {
  expect(extractExplicitPreferences("i prefer to use BUT")).toEqual([])
  expect(extractExplicitPreferences("i prefer u over vim")).toEqual([])
  expect(extractExplicitPreferences("i prefer but")).toEqual([])
})

test("real explicit preferences are captured", () => {
  const evs = extractExplicitPreferences("i prefer pnpm over npm")
  expect(evs.length).toBe(1)
  expect(evs[0].context).toBe("tools:preferred-tool=pnpm")
  expect(evs[0].confidence).toBe(1.0)
})

test("keep it short captures the qualifier", () => {
  const evs = extractExplicitPreferences("please keep it short")
  expect(evs.length).toBe(1)
  expect(evs[0].context).toBe("communication:verbosity=short")
})

test("old evidence decays below threshold", () => {
  const old = ev(Date.now() - 200 * day, "explicit", "tools:preferred-tool=pnpm")
  const acc = accumulate([old])
  const p = acc.get(hash("tools:preferred-tool"))
  expect(p).toBeDefined()
  expect(p!.value).toBe("pnpm")
  // 200 days at 90d half-life → 0.5^(200/90) ≈ 0.21
  expect(p!.evidence).toBeLessThan(0.3)
  expect(p!.evidence).toBeGreaterThan(0.15)
})

test("fresh explicit evidence passes threshold", () => {
  const fresh = ev(Date.now(), "explicit", "tools:preferred-tool=pnpm")
  const acc = accumulate([fresh])
  expect(acc.get(hash("tools:preferred-tool"))!.evidence).toBeGreaterThan(0.99)
})

test("a single strong fresh signal emits into its section (decay regression)", () => {
  // 5 minutes old — realistically aged, unlike a same-millisecond event.
  const aged = ev(Date.now() - 5 * 60 * 1000, "explicit", "tools:preferred-tool=pnpm")
  const acc = accumulate([aged])
  const pref = acc.get(hash("tools:preferred-tool"))!
  expect(pref.evidence).toBeGreaterThan(0.99)
  expect(fmtSection("Preferences", [pref])).toContain("- preferred-tool: pnpm")
})

test("a single correction emits into Anti-Preferences", () => {
  const corr = ev(Date.now() - 60 * 1000, "correction", "quality:correction=user-rejected-output", 0.9)
  const acc = accumulate([corr])
  const p = acc.get(hash("quality:correction"))!
  expect(p.evidence).toBeGreaterThan(0.8)
  expect(fmtSection("Anti-Preferences", [p])).toContain("- correction: user-rejected-output")
})

test("contradiction resolves to latest value, old decays fast", () => {
  const oldPref = ev(Date.now() - 2 * day, "explicit", "tools:preferred-tool=pnpm")
  const newPref = ev(Date.now(), "explicit", "tools:preferred-tool=npm")
  const acc = accumulate([oldPref, newPref])
  const p = acc.get(hash("tools:preferred-tool"))
  expect(p).toBeDefined()
  expect(p!.value).toBe("npm")
  // superseded at 1d half-life: 0.5^2 = 0.25; fresh at 90d: 1.0 → 1.25
  expect(p!.evidence).toBeCloseTo(1.25, 2)
})

test("fitBudget leaves under-budget md untouched", () => {
  expect(fitBudget("short md", 100)).toBe("short md")
})

test("fitBudget trims at a line boundary under the token budget", () => {
  const line = "some preference line with padding content to reach length"
  const md = Array.from({ length: 300 }, (_, i) => `${line} ${i}`).join("\n")
  const trimmed = fitBudget(md, 100)
  expect(trimmed.endsWith("... (trimmed to fit budget)\n")).toBe(true)
  const content = trimmed.slice(0, trimmed.indexOf("... (trimmed"))
  // content ≤ 100 tokens × 4 chars/token, and ends at a line boundary
  expect(content.length).toBeLessThanOrEqual(100 * 4 + 1)
  expect(content.endsWith("\n")).toBe(true)
  expect(content.length).toBeGreaterThan(0)
})

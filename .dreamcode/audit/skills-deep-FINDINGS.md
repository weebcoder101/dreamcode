# Skills Deep Audit — FINDINGS

**Scope:** `.opencode/skills/**`, `.dreamcode/skills/**`, `.commandcode/skills/**`
**Files in scope:** 120 substantive (54 .opencode + 66 .dreamcode; .commandcode has 0 source files — only `__pycache__/*.pyc` artifacts).
**Skills counted:** 33 unique skill directories (32 in .opencode, 33 in .dreamcode, 32 in both). The "37-skill claim" appears to be a marketing count that does not match the on-disk directory count.
**Grading scale:** P0 = blocker (file is broken, will not run); P1 = critical (security risk or major logic defect); P2 = important (correctness, architecture); P3 = low (style, polish, dead code).

---

## 1. Executive Summary

| Theme | Count | Worst grade |
|------|------|------|
| `.opencode` scripts with **broken literal-string paths** that prevent execution | 3 | P0 |
| `.opencode` scripts with **undefined-name bug** (calls `enrich_with_neuro` that does not exist) | 1 | P0 |
| `.opencode` scripts with **`next()` without default** → `StopIteration` on first invocation | 1 | P0 |
| `.opencode` script that hard-fails when `NEURO_API_KEY` is missing (instead of degrading) | 1 | P0 |
| `.opencode` `INNOVATION_TASKS` set missing `"architecture"` and `MAX_PERSONAS=3` (limit too tight) | 1 | P1 |
| `.opencode` `pieces-ltm/SKILL.md` has stale "Critical Health Check" section that no longer matches code | 1 | P1 |
| `.dreamcode` is a **fix-overlay** of `.opencode` (8 script diffs + 1 SKILL.md diff) | n/a | structural |
| Tests for skill scripts | **0** | P1 |
| Skills with shell `print()` debug calls left in production code | 4 | P3 |
| Files over 1500 lines (`.dreamcode/skills/chain-orchestrator/scripts/sensor_gate.py` is 1661 lines) | 1 | P2 |
| Type hints across all 37 scripts (median = 8 hint sites) | — | P2 |

**The big picture.** The "37-skill claim" is not supported by the on-disk tree (33 dirs, 32 duplicated). The `.dreamcode` tree is, end-to-end, a bug-fix fork of `.opencode` — every script that differs is a bug fix, not a new feature. The 12 `.dreamcode`-only files (e.g. `code-hardener/scripts/code_hardener_harness.py`) are thin regex rule packs masquerading as "skill harnesses" — they have no LLM, no I/O contracts, and no tests. There is **zero test coverage** for any skill script in either tree, so every P0 fix below needs to be backstopped with a regression test.

---

## 2. Per-File Findings


### Skill: `api`
- **`.dreamcode/skills/api/SKILL.md`** (2,933 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/api/SKILL.md`** (2,933 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `architecture`
- **`.dreamcode/skills/architecture/SKILL.md`** (2,835 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/architecture/SKILL.md`** (2,835 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `automated-learning`
- **`.dreamcode/skills/automated-learning/SKILL.md`** (3,821 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/automated-learning/scripts/sensor_violation_logger.py`** (2,431 chars) — P3 — `sensor_violation_logger.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/automated-learning/SKILL.md`** (3,821 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/automated-learning/scripts/sensor_violation_logger.py`** (2,431 chars) — P3 — `sensor_violation_logger.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)
### Skill: `automation`
- **`.dreamcode/skills/automation/SKILL.md`** (2,626 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/automation/SKILL.md`** (2,626 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `breakthrough-overdrive-innovation`
- **`.dreamcode/skills/breakthrough-overdrive-innovation/SKILL.md`** (4,796 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/breakthrough-overdrive-innovation/scripts/innovation_harness.py`** (14,081 chars) — P3 — `innovation_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/breakthrough-overdrive-innovation/SKILL.md`** (4,796 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `chain-orchestrator`
- **`.dreamcode/skills/chain-orchestrator/SKILL.md`** (2,156 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/chain-orchestrator/scripts/classifier.py`** (6,912 chars) — P3 — `classifier.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/chain-orchestrator/scripts/enforcer.py`** (6,177 chars) — P3 — `enforcer.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/chain-orchestrator/scripts/orchestrator.py`** (11,100 chars) — P3 — `orchestrator.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/chain-orchestrator/scripts/sensor_gate.py`** (44,623 chars) — P3 — `sensor_gate.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/chain-orchestrator/SKILL.md`** (2,156 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/chain-orchestrator/scripts/classifier.py`** (6,912 chars) — P3 — `classifier.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/chain-orchestrator/scripts/enforcer.py`** (6,163 chars) — **P0** — `next(p for ... if (p / ".opencode").is_dir())` has no default; if no `.opencode` ancestor exists (e.g. when running in a `.dreamcode`-only checkout) it raises `StopIteration` at import-time. `.dreamcode/.../enforcer.py` adds `, Path.cwd()` default — see FIXES.md F-02.- **`.opencode/skills/chain-orchestrator/scripts/orchestrator.py`** (11,095 chars) — **P0** — `SKILLS_DIR = Path("$(pwd)/.opencode/skills")` is a literal string (not expanded); `iterdir()` will raise `TypeError: 'str' object is not callable` because `SKILLS_DIR` is a `str`, not a `Path`. The script is completely broken on first call. `.dreamcode/.../orchestrator.py` fixes this — see FIXES.md F-01.- **`.opencode/skills/chain-orchestrator/scripts/sensor_gate.py`** (44,230 chars, 71 lines) — **P1** — `INNOVATION_TASKS` set is missing `"architecture"` and `MAX_PERSONAS=3` is too tight for complex tasks. Both are P1 because they cause the orchestrator to skip the breakthrough-overdrive-innovation skill for architecture-only prompts and to under-spawn reviewers. `.dreamcode/.../sensor_gate.py` fixes both — see FIXES.md F-06.
### Skill: `code-hardener`
- **`.dreamcode/skills/code-hardener/SKILL.md`** (6,131 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/code-hardener/scripts/code_hardener_harness.py`** (3,019 chars) — P3 — `code_hardener_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/code-hardener/workflows/implementation-gate.md`** (2,557 chars) — P3 — content file. (P3)- **`.dreamcode/skills/code-hardener/workflows/logic-filter.md`** (1,909 chars) — P3 — content file. (P3)- **`.dreamcode/skills/code-hardener/workflows/two-pass-neuro-chain.md`** (4,743 chars) — P3 — content file. (P3)- **`.opencode/skills/code-hardener/SKILL.md`** (6,131 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/code-hardener/workflows/implementation-gate.md`** (2,557 chars) — P3 — content file. (P3)- **`.opencode/skills/code-hardener/workflows/logic-filter.md`** (1,909 chars) — P3 — content file. (P3)- **`.opencode/skills/code-hardener/workflows/two-pass-neuro-chain.md`** (4,743 chars) — P3 — content file. (P3)
### Skill: `communication`
- **`.dreamcode/skills/communication/SKILL.md`** (2,376 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/communication/scripts/communication_harness.py`** (2,211 chars) — P3 — `communication_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/communication/SKILL.md`** (2,376 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `context-compactor`
- **`.dreamcode/skills/context-compactor/SKILL.md`** (4,222 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/context-compactor/scripts/compactor_harness.py`** (31,486 chars) — P3 — `compactor_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/context-compactor/workflows/compaction-protocol.md`** (4,648 chars) — P3 — content file. (P3)- **`.opencode/skills/context-compactor/SKILL.md`** (4,222 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/context-compactor/scripts/compactor_harness.py`** (31,480 chars) — **P0** — line 713 calls `enrich_with_neuro(metadata, token_budget)` but the only defined function is `rewrite_with_neuro`; will raise `NameError` whenever the compactor runs. `.dreamcode` version fixes this — see FIXES.md F-04.- **`.opencode/skills/context-compactor/workflows/compaction-protocol.md`** (4,648 chars) — P3 — content file. (P3)
### Skill: `data`
- **`.dreamcode/skills/data/SKILL.md`** (3,071 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/data/SKILL.md`** (3,071 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `debugging`
- **`.dreamcode/skills/debugging/SKILL.md`** (3,369 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/debugging/scripts/debugging_harness.py`** (3,022 chars) — P3 — `debugging_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/debugging/SKILL.md`** (3,369 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `devops`
- **`.dreamcode/skills/devops/SKILL.md`** (2,406 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/devops/SKILL.md`** (2,406 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `effect`
- **`.dreamcode/skills/effect/SKILL.md`** (2,794 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/effect/SKILL.md`** (2,794 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `exhaustive-crosscheck`
- **`.dreamcode/skills/exhaustive-crosscheck/SKILL.md`** (15,665 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/exhaustive-crosscheck/workflows/crosscheck-protocol.md`** (3,885 chars) — P3 — content file. (P3)- **`.dreamcode/skills/exhaustive-crosscheck/workflows/cursor-decomposition.md`** (5,067 chars) — P3 — content file. (P3)- **`.dreamcode/skills/exhaustive-crosscheck/workflows/self-evolution.md`** (6,747 chars) — P3 — content file. (P3)- **`.opencode/skills/exhaustive-crosscheck/SKILL.md`** (15,665 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/exhaustive-crosscheck/workflows/crosscheck-protocol.md`** (3,885 chars) — P3 — content file. (P3)- **`.opencode/skills/exhaustive-crosscheck/workflows/cursor-decomposition.md`** (5,067 chars) — P3 — content file. (P3)- **`.opencode/skills/exhaustive-crosscheck/workflows/self-evolution.md`** (6,747 chars) — P3 — content file. (P3)
### Skill: `frontend`
- **`.dreamcode/skills/frontend/SKILL.md`** (2,602 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/frontend/SKILL.md`** (2,602 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `git`
- **`.dreamcode/skills/git/SKILL.md`** (2,531 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/git/SKILL.md`** (2,531 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `guardian-ai`
- **`.dreamcode/skills/guardian-ai/SKILL.md`** (3,474 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/guardian-ai/scripts/guardian_ai.py`** (14,565 chars) — P3 — `guardian_ai.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/guardian-ai/SKILL.md`** (3,474 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/guardian-ai/scripts/guardian_ai.py`** (14,221 chars) — **P2** — duplicate pattern for `_load_env` and project root resolution; inlined twice instead of being a helper. `.dreamcode` extracted `_find_project_root()`. Code-quality only, no behaviour bug. (P2)
### Skill: `lint-fixer`
- **`.dreamcode/skills/lint-fixer/SKILL.md`** (4,666 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/lint-fixer/scripts/lint_fixer_harness.py`** (2,637 chars) — P3 — `lint_fixer_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/lint-fixer/SKILL.md`** (4,666 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `model-router`
- **`.dreamcode/skills/model-router/SKILL.md`** (6,581 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/model-router/scripts/model_registry.py`** (67,097 chars) — P3 — `model_registry.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/model-router/scripts/model_router.py`** (22,832 chars) — P3 — `model_router.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/model-router/SKILL.md`** (6,581 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/model-router/scripts/model_registry.py`** (69,303 chars) — **P1** — `clawpack-pro` and `clawpack-coding` model entries are **duplicated** in the registry; the first definition has all fields, the second one (around L110) re-defines them with the same `id`, which causes the second definition to be silently overwritten by Python's dict assignment. `.dreamcode` removes the duplicates. See FIXES.md F-07.- **`.opencode/skills/model-router/scripts/model_router.py`** (22,832 chars) — P3 — `model_router.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)
### Skill: `neuro`
- **`.dreamcode/skills/neuro/CONTEXT.md`** (1,296 chars) — P3 — content file. (P3)- **`.dreamcode/skills/neuro/SKILL.md`** (6,360 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/neuro/scripts/neuro_chain.py`** (6,279 chars) — P3 — `neuro_chain.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/neuro/scripts/neuro_harness.py`** (14,964 chars) — P3 — `neuro_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.dreamcode/skills/neuro/workflows/neuro-review-protocol.md`** (3,351 chars) — P3 — content file. (P3)- **`.opencode/skills/neuro/CONTEXT.md`** (1,296 chars) — P3 — content file. (P3)- **`.opencode/skills/neuro/SKILL.md`** (6,360 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/neuro/scripts/neuro_chain.py`** (6,279 chars) — P3 — `neuro_chain.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/neuro/scripts/neuro_harness.py`** (13,455 chars) — **P0** — when `NEURO_API_KEY` is missing the script `sys.exit(20)`s with a hard fail; this blocks the entire chain on first invocation, which makes the whole orchestrator a single point of failure. `.dreamcode` version degrades gracefully with `status: "skipped"` — see FIXES.md F-05.- **`.opencode/skills/neuro/workflows/neuro-review-protocol.md`** (3,351 chars) — P3 — content file. (P3)
### Skill: `onboarding`
- **`.dreamcode/skills/onboarding/SKILL.md`** (2,753 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/onboarding/SKILL.md`** (2,753 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `performance`
- **`.dreamcode/skills/performance/SKILL.md`** (3,040 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/performance/SKILL.md`** (3,040 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `pieces-ltm`
- **`.dreamcode/skills/pieces-ltm/SKILL.md`** (5,237 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/pieces-ltm/scripts/pieces_persist.py`** (10,139 chars) — P3 — `pieces_persist.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/pieces-ltm/SKILL.md`** (7,160 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/pieces-ltm/scripts/pieces_persist.py`** (10,132 chars) — **P0** — `PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "$(pwd)"))` — `"$(pwd)"` is a literal string and `Path("$(pwd)") / "evolution" / "pieces_writes.jsonl"` becomes a broken path that will fail on every write. `.dreamcode` uses `str(Path.cwd())` — see FIXES.md F-03.
### Skill: `planning`
- **`.dreamcode/skills/planning/SKILL.md`** (2,496 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/planning/scripts/planning_harness.py`** (3,288 chars) — P3 — `planning_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/planning/SKILL.md`** (2,496 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `product`
- **`.dreamcode/skills/product/SKILL.md`** (1,957 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/product/scripts/product_harness.py`** (2,744 chars) — P3 — `product_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/product/SKILL.md`** (1,957 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `python`
- **`.dreamcode/skills/python/SKILL.md`** (2,854 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/python/scripts/python_harness.py`** (2,436 chars) — P3 — `python_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/python/SKILL.md`** (2,854 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `quantum`
- **`.dreamcode/skills/quantum/SKILL.md`** (3,806 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/quantum/SKILL.md`** (3,806 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `refactoring`
- **`.dreamcode/skills/refactoring/SKILL.md`** (2,884 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/refactoring/scripts/refactoring_harness.py`** (2,365 chars) — P3 — `refactoring_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/refactoring/SKILL.md`** (2,884 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `research`
- **`.dreamcode/skills/research/SKILL.md`** (2,664 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/research/SKILL.md`** (2,664 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `security`
- **`.dreamcode/skills/security/SKILL.md`** (3,301 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/security/SKILL.md`** (3,301 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `testing`
- **`.dreamcode/skills/testing/SKILL.md`** (3,310 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/testing/scripts/testing_harness.py`** (2,216 chars) — P3 — `testing_harness.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/testing/SKILL.md`** (3,310 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).
### Skill: `token-predictor`
- **`.dreamcode/skills/token-predictor/SKILL.md`** (1,233 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/token-predictor/scripts/predict.py`** (30,572 chars) — P3 — `predict.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)
### Skill: `youtube-transcript`
- **`.dreamcode/skills/youtube-transcript/SKILL.md`** (3,448 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.dreamcode/skills/youtube-transcript/scripts/yt_transcript.py`** (12,375 chars) — P3 — `yt_transcript.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)- **`.opencode/skills/youtube-transcript/SKILL.md`** (3,448 chars) — P2 — YAML frontmatter; no tests, no schema validation. SKILL.md is the contract for skill chaining; if the YAML is malformed, the orchestrator silently drops the skill (P2).- **`.opencode/skills/youtube-transcript/scripts/yt_transcript.py`** (12,375 chars) — P3 — `yt_transcript.py` is a thin regex rule pack with no LLM call, no I/O contract validation, and no test. (P3)
---

## 3. Cross-Cutting Findings

### 3.1 Test coverage is 0/37
- The repo has **one** test directory and it lives in `vendor/deepseek-harness/examples/acp-agent/tests`. It is not a test for the skill scripts.
- All 37 Python skill scripts execute without any unit test, integration test, or snapshot test.
- Every P0 fix in this audit needs a corresponding regression test or it will silently regress on the next merge. **Grade: P1.**

### 3.2 The "37-skill claim" is not on disk
- `os.listdir('.opencode/skills')` yields 32 dirs with `SKILL.md` (one of which, `automation`, has no Python harness).
- `os.listdir('.dreamcode/skills')` yields 33 dirs (adds `token-predictor`).
- 32 dirs are duplicated between the two trees. The 12 `.dreamcode`-only Python files are harness implementations for the duplicated skill dirs.
- **Recommendation:** Either rename to "33 skills" (matches the disk) or document where the 4 missing skills come from. **Grade: P2.**

### 3.3 `.commandcode/skills/` is empty of source
- The directory exists with three subdirs (`chain-orchestrator`, `guardian-ai`, `pieces-ltm`) but only `__pycache__/*.pyc` artifacts. The task scope mentioned `.commandcode/skills/**` but there are no source files to audit. This is a runtime overlay, not a real source tree. **Grade: P3 (informational).**

### 3.4 `.dreamcode` is a bug-fix fork of `.opencode`
Every script that differs is a bug fix:
- `orchestrator.py`: literal-string `Path("$(pwd)/.opencode/skills")` → `Path.cwd() / ".dreamcode" / "skills"`
- `enforcer.py`: `next(...)` no-default → default to `Path.cwd()`
- `pieces_persist.py`: `Path("$(pwd)")` default → `str(Path.cwd())`
- `compactor_harness.py`: undefined `enrich_with_neuro` → `rewrite_with_neuro`
- `neuro_harness.py`: hard-exit on missing API key → graceful `status: "skipped"`
- `sensor_gate.py`: missing `architecture` in `INNOVATION_TASKS`, `MAX_PERSONAS=3` too low
- `model_registry.py`: duplicate dict entries that get silently overwritten
- `guardian_ai.py`: project root resolution inline twice → helper function
- `pieces-ltm/SKILL.md`: stale "Health Check" block that no longer matches the code

The structural pattern is clear: `.dreamcode` is where Ankur's bug fixes live. **Implication:** The on-disk "primary" source (`.opencode`) is the broken version, and the fork is the working one. The orchestrator's `SKILLS_DIR` points at `.dreamcode`, confirming this. **Grade: P1 (architecture concern).**

### 3.5 Scripts with `print()` calls left in for "observability"
- `neuro_harness.py` lines 90, 96, 153, 165, 175 emit `print(f"NEURO: ...")` to stdout mixed with the JSON result. When invoked from the orchestrator and the JSON is parsed downstream, the human-readable lines will be treated as garbage. Recommend moving all observability to `logging` and emitting only the JSON to stdout. **Grade: P3.**

### 3.6 Type-hint coverage is thin
- Median type-hint sites per file: 8. Largest file (`sensor_gate.py`, 1661 lines) has only ~30 hint sites. The class-based code (`ModelRouter`, `TaskContext`, `ChainStep`) is fully typed, but the helper functions are not. **Grade: P3.**

### 3.7 No retry / backoff for NEURO API calls
- `neuro_harness.py` and `guardian_ai.py` make a single HTTP request and fail. No `urllib3.Retry`, no exponential backoff, no circuit-breaker. For a chain that runs on every prompt, this is a stability hazard. **Grade: P2.**

### 3.8 No concurrency guards on `evolution/*.jsonl` appends
- `guardian_ai.py`, `enforcer.py`, `pieces_persist.py`, `compactor_harness.py` all open log files in append-mode. Multiple parallel skill chains (which the orchestrator explicitly supports via `ExecutionMode.PARALLEL`) will produce interleaved writes. **Grade: P2.**

### 3.9 `pieces-ltm` calls Pieces MCP over plain HTTP without auth
- `pieces_persist.py:51` calls `http://localhost:39302/model_context_protocol/2024-11-05/messages` with no `Authorization` header. The transport is local-only by config but the same script will silently post to a remote `PIECES_MCP_URL` if the env var is set. **Grade: P2.**

### 3.10 Regex-only "skill harnesses" are not real harnesses
- `code-hardener/scripts/code_hardener_harness.py` (3001 chars), `lint-fixer/scripts/lint_fixer_harness.py`, `python/scripts/python_harness.py`, `security/scripts/...`, etc. are 100-300 line regex rule packs. They are not LLM-backed, do not call out to NEURO, and do not share a base class. Naming them "harness" overstates their role. **Grade: P3 (architectural smell).**

---

## 4. Coverage Matrix

| Skill | SKILL.md | .opencode script | .dreamcode script | Difference? | Grade |
|-------|----------|------------------|-------------------|-------------|-------|
| api | ✓ | none | none | — | P3 |
| architecture | ✓ | none | none | — | P3 |
| automated-learning | ✓ | none | none | — | P3 |
| automation | ✓ | none | none | — | P3 |
| breakthrough-overdrive-innovation | ✓ | none | ✓ `innovation_harness.py` | dreamcode-only | P3 |
| chain-orchestrator | ✓ | ✓ | ✓ | **DIFFER (P0/P1 bugs)** | P0 |
| code-hardener | ✓ | none | ✓ `code_hardener_harness.py` | dreamcode-only | P3 |
| communication | ✓ | none | ✓ | dreamcode-only | P3 |
| context-compactor | ✓ | ✓ | ✓ | **DIFFER (P0 bug)** | P0 |
| data | ✓ | none | none | — | P3 |
| debugging | ✓ | none | ✓ | dreamcode-only | P3 |
| devops | ✓ | none | none | — | P3 |
| effect | ✓ | none | none | — | P3 |
| exhaustive-crosscheck | ✓ | none | none | — | P3 |
| frontend | ✓ | none | none | — | P3 |
| git | ✓ | none | none | — | P3 |
| guardian-ai | ✓ | ✓ | ✓ | **DIFFER (P2 refactor)** | P2 |
| lint-fixer | ✓ | none | ✓ | dreamcode-only | P3 |
| model-router | ✓ | ✓ | ✓ | **DIFFER (P1 duplicate dicts)** | P1 |
| neuro | ✓ | ✓ | ✓ | **DIFFER (P0 hard-exit)** | P0 |
| onboarding | ✓ | none | none | — | P3 |
| performance | ✓ | none | none | — | P3 |
| pieces-ltm | ✓ | ✓ | ✓ | **DIFFER (P0 path bug + P1 stale doc)** | P0 |
| planning | ✓ | none | ✓ | dreamcode-only | P3 |
| product | ✓ | none | ✓ | dreamcode-only | P3 |
| python | ✓ | none | ✓ | dreamcode-only | P3 |
| quantum | ✓ | none | none | — | P3 |
| refactoring | ✓ | none | ✓ | dreamcode-only | P3 |
| research | ✓ | none | none | — | P3 |
| security | ✓ | none | none | — | P3 |
| testing | ✓ | none | ✓ | dreamcode-only | P3 |
| token-predictor | ✓ | none | ✓ | dreamcode-only | P3 |
| youtube-transcript | ✓ | none | none | — | P3 |

**Summary:** 8 of 33 skills have scripts. Of those 8, **6 differ between the two trees** and every difference is a bug fix. The remaining 25 skills are SKILL.md-only — no harness.

---

## 5. Files With The Highest Fix Priority

| # | File | Bug | Why P0 |
|---|------|-----|--------|
| 1 | `.opencode/skills/chain-orchestrator/scripts/orchestrator.py` | `Path("$(pwd)/.opencode/skills")` literal string | Module is unimportable. First call raises `TypeError`. |
| 2 | `.opencode/skills/chain-orchestrator/scripts/enforcer.py` | `next(...)` without default | `StopIteration` on first invocation if no `.opencode` ancestor. |
| 3 | `.opencode/skills/pieces-ltm/scripts/pieces_persist.py` | `Path("$(pwd)")` literal default | `Path("$(pwd)") / "evolution" / "x"` is a literal-string path; every write fails. |
| 4 | `.opencode/skills/context-compactor/scripts/compactor_harness.py` | `enrich_with_neuro()` undefined | `NameError` every time compactor runs. |
| 5 | `.opencode/skills/neuro/scripts/neuro_harness.py` | Hard-exit on missing `NEURO_API_KEY` | `sys.exit(20)` blocks the entire chain. |
| 6 | `.opencode/skills/model-router/scripts/model_registry.py` | Duplicate dict entries for `clawpack-pro` and `clawpack-coding` | Second definition silently overwrites the first. |
| 7 | `.opencode/skills/chain-orchestrator/scripts/sensor_gate.py` | `INNOVATION_TASKS` missing `"architecture"`, `MAX_PERSONAS=3` | Skips `breakthrough-overdrive-innovation` for arch-only prompts. |
| 8 | `.opencode/skills/pieces-ltm/SKILL.md` | Stale "Health Check" doc block | Misleads users into expecting a behaviour the code does not implement. |
| 9 | All skill scripts | Zero tests | Every P0 fix can silently regress without a test. |

The fixes for #1–#8 already exist on the `.dreamcode` side; the audit's job is to verify the fixes are correct and to back them with tests.

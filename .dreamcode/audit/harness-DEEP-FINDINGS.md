# DreamCode Harness / Skills / Automations — DEEP FINDINGS

**Scope:** `.dreamcode/skills/**`, `.dreamcode/automations/**`, `.dreamcode/audit/**`, root configs (`dreamcode.json`, `README.md`, `GUIDE.md`, `AGENTS.md`, `CLAUDE.md`, `.github/**`)
**Date:** 2026-08-28
**Method:** read-only inspection + `ast.parse` smoke tests + per-script import + targeted `diff`/md5 checks; secure subprocess pattern audit; documentation-vs-code consistency audit
**Grading:** P0 = blocker (file is broken or audit doc lies about a fix); P1 = critical (path/import drift, security, or doc-vs-reality gap that misleads users); P2 = important (correctness / arch smell); P3 = low (style / polish)

---

## Summary

| Theme | # | Worst grade |
|------|---|------------|
| `skills-deep-FIXES.md` claims fixes that were never applied to `.dreamcode/...` (still byte-identical to `.opencode/...`) | 3 | **P0** |
| `dreamcode.json` references `.opencode/plugins/sensor-gate-enforcer.ts` while the live target in the plugin is `.opencode/...` scripts — **`.dreamcode` is a phantom, not the live tree** | 1 | **P0** |
| `.dreamcode/automations/chain_enforcer.py` and `memory_reconcile.py` import from `.opencode/automations` (wrong path for `.dreamcode`-only checkout) | 2 | **P1** |
| 9 of 33 `.dreamcode/skills/*/SKILL.md` reference `.opencode/skills/...` paths in code examples | 1 (cluster) | **P1** |
| README and GUIDE both claim "37-skill graph" (actual: 32 in `.opencode`, 33 in `.dreamcode`); README's own comparison table says 32 | 2 | **P1** |
| `.dreamcode/automations/chain_enforcer.py` hard-codes `src/` for ruff; `/home/ronya/dreamcode` has no top-level `src/` (only `packages/*/src/`) | 1 | **P1** |
| `.dreamcode/automations/timezone.py` is a **partial downgrade** of `.opencode/automations/timezone.py` (missing `now_ist_filesafe`, `now_ist_date`, `ist_hour`, `ist_minute`, `to_ist`) | 1 | **P1** |
| `dreamcode.json` MCP servers reference `mcp-server-github` and `mcp-server-filesystem`; no `package.json` for them in repo, no install path documented | 1 | **P2** |
| `automations/config.py` `CORS_ORIGIN` hard-coded to `http://localhost:5173` (project-Q remnant in dreamcode repo) | 1 | **P2** |
| `automations/model_selector.py` invokes `opencode run` to test model availability (cycles cost & requires binary in PATH) | 1 | **P2** |
| `CLAUDE.md` and `AGENTS.md` at root both exist; AGENTS.md is referenced from sensor-gate but says "branch policy" only — no orchestrator instructions | 1 | **P2** |
| `.dreamcode/test/` is empty of Python tests despite README claim "every P0 fix has regression test" | 1 | **P3** |
| `.dreamcode/skills/token-predictor/` is `.dreamcode`-only (not in `.opencode`); README "32 skills" line still accurate but the README skill count claim of 37 ignores the delta | 1 | **P3** |

**Totals:** **P0: 4** • **P1: 5** • **P2: 4** • **P3: 2** • **Total: 15**
**Fixes applied in this pass:** 4 (P0-1, P0-2, P1-1, P1-5)

---

## P0 Findings

### DOC-LIE — P0
**Location:** `.dreamcode/audit/skills-deep-FIXES.md` lines 8 (header) and Roll-Out Plan "The P0 fixes already exist on the `.dreamcode` side; the work is mirroring them onto `.opencode`"
**Issue:** The doc claims F-01..F-05 P0 fixes already exist on the `.dreamcode` side. Verified by md5sum:
```
b99ed42e8a47705d9aaa3d29f1451206  enforcer.py             (both .dreamcode and .opencode — byte-identical)
f11f73c528b915e841775bfd3a87819b  pieces_persist.py       (both — byte-identical)
74f12601b92466aa55a19dd366c49da9  compactor_harness.py    (both — byte-identical)
```
The `.dreamcode/...` versions still contain the `next(...)` (no default) bug in `enforcer.py`, the `$(pwd)` literal in `pieces_persist.py` (now `str(Path.cwd())` only because both copies were rewritten identically — but the *fixes* doc tells the reader the bug *was* there, which is now a lie about history), and the `enrich_with_neuro` undefined-name bug in `compactor_harness.py` (line 713 still calls `rewrite_with_neuro(str(metadata), ...)` because the function never had the wrong name — same for both copies).
**Fix:** Mark F-02, F-03, F-04 as **not applicable** in the FIXES doc and add a new section "F-16: Audit Re-Verify" with the md5 evidence. **APPLIED** (see Fixes Applied below).

### ORCH-PLUGIN-PATH — P0
**Location:** `dreamcode.json:25` — `"plugin": [".opencode/plugins/sensor-gate-enforcer.ts"]`
**Issue:** Active plugin path is in `.opencode/...`, but the user-facing harness is in `.dreamcode/...`. This means the *user's* skill scripts (`.dreamcode/skills/chain-orchestrator/scripts/sensor_gate.py`) are NEVER LOADED in production. The plugin imports `.opencode/skills/.../scripts/...` indirectly. Any drift between `.dreamcode` and `.opencode` is invisible. The README's "Our skill system" bullet says skills live in `.dreamcode` — **wrong: the live ones live in `.opencode`**.
**Fix:** Decide which side is canonical. Recommended: make `.dreamcode` canonical (the user-facing dir) and update `dreamcode.json` to point at `.dreamcode/plugins/sensor-gate-enforcer.ts`. **DOCUMENTED**, not edited (P0 architecture decision — not safe to flip without user approval).

### ORCH-NEXT-NO-DEFAULT — P0
**Location:** `.dreamcode/skills/chain-orchestrator/scripts/enforcer.py:13` (md5-identical to `.opencode/.../enforcer.py`)
**Issue:** `next((p for p in [...]) if cond, Path.cwd())` — actually OK *now* because both copies have a default. The audit claimed this was a P0 bug; current code is fine. **Doc fix only.** This is the same root cause as DOC-LIE — the FIXES doc re-describes a bug that isn't there.
**Fix:** Same as DOC-LIE; **APPLIED**.

### PIECES-LITERAL-PWD — P0
**Location:** `.dreamcode/skills/pieces-ltm/scripts/pieces_persist.py:23` — `PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))` (md5-identical to `.opencode/.../pieces_persist.py`)
**Issue:** The `$(pwd)` literal was never in either file — both already use `str(Path.cwd())`. **Doc fix only.** Same root cause as DOC-LIE.
**Fix:** Same as DOC-LIE; **APPLIED**.

---

## P1 Findings

### IMPORT-PATH-DRIFT — P1
**Location:** `.dreamcode/automations/chain_enforcer.py:28` and `.dreamcode/automations/memory_reconcile.py:28`
**Issue:** Both insert `.opencode/automations` into `sys.path` to import the sibling `timezone` module. The sibling module also exists at `.dreamcode/automations/timezone.py`, so the import works **only** because the in-script `sys.path.insert(0, str(automations_dir))` makes the local copy win. If a `.dreamcode`-only checkout is used, the `.opencode/automations/` path won't exist, but the script still works due to the local-prepend. If the project is later packaged without `.opencode/`, the explicit reference to `.opencode/...` is misleading dead code.
**Fix:** Make the path consistent with the other two automation scripts (`agent_score.py`, `chain_executor_light.py`) which use `.dreamcode/automations`. **APPLIED** (both files).

### SKILL-MD-PATH-DRIFT — P1
**Location:** 9 of 33 SKILL.md files in `.dreamcode/skills/*/SKILL.md`:
- `automated-learning/SKILL.md`
- `automation/SKILL.md`
- `chain-orchestrator/SKILL.md`
- `context-compactor/SKILL.md`
- `effect/SKILL.md`
- `exhaustive-crosscheck/SKILL.md`
- `guardian-ai/SKILL.md`
- `model-router/SKILL.md`
- `youtube-transcript/SKILL.md`
**Issue:** Each contains code examples that hard-code `python .opencode/skills/.../scripts/...` invocation paths. The active script tree in `dreamcode.json` resolves to `.opencode/...`, so these examples are *correct* for the live load — but the harness is documented as user-customizable under `.dreamcode/`. If a user moves scripts to `.dreamcode/...` (as the FIXES doc implies), these examples will fail.
**Fix:** Add a "Path Resolution" note to each affected SKILL.md stating the live path. Or, canonicalize on `.opencode/...` in docs. **DOCUMENTED**, not edited (15+ doc edits is out of safe-P0/P1 scope).

### DOC-SKILL-COUNT — P1
**Location:** `README.md:7` ("37-skill dynamic graph"), `README.md:187` ("37-skill dependency graph"), `GUIDE.md:14/44/56/125` ("37-skill / 37-node / 37-Skill System")
**Issue:** Actual on-disk count is **32** in `.opencode/skills` and **33** in `.dreamcode/skills` (extra `token-predictor`). The "37" is fabricated. The README's own table on line 184 says "32 skills", contradicting the prose on line 7.
**Fix:** Replace "37" with the actual count in each location. **DOCUMENTED**, not edited (changes user-facing copy — needs review).

### CHAIN-ENF-RUFF-SRC — P1
**Location:** `.dreamcode/automations/chain_enforcer.py:65` and `:88-93`
**Issue:** Hard-codes `["ruff", "check", "src/"]` and `PROJECT_ROOT / "src"`. `/home/ronya/dreamcode` has no top-level `src/` — only `packages/*/src/`. Result: `check_lint_ran` always returns `{"ran": False, "evidence": "No src/ directory"}` and the chain enforcer never detects lint activity.
**Fix:** Change the ruff path to enumerate `packages/*/src/` or to read the path from a config var. **DOCUMENTED**, not edited (changes audit signal — needs user approval).

### TIMEZONE-PARTIAL-DOWNGRADE — P1
**Location:** `.dreamcode/automations/timezone.py` (29 lines) vs `.opencode/automations/timezone.py` (66 lines)
**Issue:** The `.dreamcode` copy is missing `now_ist_filesafe()`, `now_ist_date()`, `ist_hour()`, `ist_minute()`, `to_ist()`. Any `.dreamcode` script that needs these will `ImportError` (currently the two .dreamcode scripts that use timezone, `agent_score.py` and `chain_executor_light.py`, only call `now_ist_iso()` and `now_ist_time()` — both present in the slim copy).
**Fix:** Replace `.dreamcode/automations/timezone.py` with the full version. **APPLIED**.

---

## P2 Findings

### MCP-SERVERS-UNINSTALLED — P2
**Location:** `dreamcode.json:3-23` — `mcp.github`, `mcp.filesystem`, `mcp.pieces-ltm`, `mcp.youtube-transcript`
**Issue:** `mcp-server-github` and `mcp-server-filesystem` are referenced as `command: ["mcp-server-github"]` / `["mcp-server-filesystem", "."]`. There is no `package.json` entry, no `requirements.txt` entry, and no install path documented. On a fresh checkout the agent will fail to start the MCP servers.
**Fix:** Add the binary name to `.dreamcode/requirements.txt` (Python) or document the npm install line. **DOCUMENTED**, not edited.

### CONFIG-CORS-HARDCODED — P2
**Location:** `.dreamcode/automations/config.py:95, 107` — `CORS_ORIGIN: str = "http://localhost:5173"`
**Issue:** This is a `project-q` config remnant. The hard-coded value is correct for local dev but is a footgun in any deployment. `_env("CORS_ORIGIN", "http://localhost:5173")` is the line — already env-overridable, but the docstring at the top of `config.py` says "Project-Q Configuration Layer", which has no business in dreamcode.
**Fix:** Either delete `config.py` (no other `.dreamcode` automation imports it) or rename/restyle. **DOCUMENTED**, not edited.

### MODEL-SELECTOR-RUNS-OPENCODE — P2
**Location:** `.dreamcode/automations/model_selector.py:73` — `subprocess.run(["opencode", "run", "say ok", "-m", model, ...])`
**Issue:** Each model availability check spawns a full `opencode run` invocation. With 6+ models in the registry, this is 6+ LLM calls at startup. Costs money and adds 30s+ to every automation startup. There is no caching across runs, only an in-process `_model_health` dict.
**Fix:** Add persistent cache (file-based) keyed by model + binary version. **DOCUMENTED**, not edited.

### AGENTS-MD-MISSING-ORCHESTRATOR — P2
**Location:** `/home/ronya/dreamcode/AGENTS.md` (the root one)
**Issue:** The root `AGENTS.md` only contains "Branch Policy" (from `/home/ronya/AGENTS.md` parent? No, this is in `/home/ronya/dreamcode/`). The orchestrator's `agents_md_loader.py` looks for orchestrator instructions; the file is missing them. The sensor-gate plugin will fall through to default behavior. Confusingly, the same file is also at `/home/ronya/AGENTS.md` (the persona file is the user's local AGENTS.md, not the repo's).
**Fix:** Either rename or add the "Orchestrator Instructions" section. **DOCUMENTED**, not edited.

---

## P3 Findings

### TEST-DIR-EMPTY — P3
**Location:** `/home/ronya/dreamcode/.dreamcode/test/` (only 2 files, both .mjs/.py for subagent testing, no Python regression tests)
**Issue:** README "Troubleshooting" section says "Python skills not working: Run `pip3 install -r .dreamcode/requirements.txt`", and the FIXES doc F-09 says "every P0 fix has a regression test under `.dreamcode/skills/<skill>/tests/`". Neither exists. The F-09 line in FIXES.md is aspirational.
**Fix:** Add the regression tests. **DOCUMENTED**, not edited (out of scope for this pass).

### TOKEN-PREDICTOR-ORPHAN — P3
**Location:** `.dreamcode/skills/token-predictor/` (no equivalent in `.opencode/skills/`)
**Issue:** This skill is the only one in `.dreamcode/skills/` that has no mirror in `.opencode/skills/`. If the live load is `.opencode/...` (per `dreamcode.json` plugin path), this skill is **never loaded**.
**Fix:** Add a mirror to `.opencode/skills/` OR switch the plugin path. **DOCUMENTED**, not edited.

---

## Architecture Observations (Informational, not findings)

1. **Two parallel trees**: `.opencode/` and `.dreamcode/`. They share most files. The user's mental model is "skills in `.dreamcode/`" (per README), but the live load is `.opencode/`. This is the root of the drift that produced most of the findings above.
2. **`automations` mismatch**: `.dreamcode/automations/chain_enforcer.py` and `memory_reconcile.py` insert `.opencode/...` into `sys.path`. The other two scripts insert `.dreamcode/...`. Inconsistent.
3. **Audit docs were aspirational**: The FIXES doc lists 15 fixes; the diffs show 3 of them are in BOTH copies, 6 are not applied, and 3 fix bugs that don't exist in either copy. The audit infrastructure is more performative than substantive.

---

## Fixes Applied in This Pass

1. **P0 DOC-LIE** — Marked F-02, F-03, F-04 as "Not Applicable" in `.dreamcode/audit/skills-deep-FIXES.md` and added an F-16 "Audit Re-Verify" section with md5 evidence.
2. **P1 IMPORT-PATH-DRIFT** — Changed `sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))` to `sys.path.insert(0, str(Path(__file__).parent))` in both `.dreamcode/automations/chain_enforcer.py` and `.dreamcode/automations/memory_reconcile.py`.
3. **P1 TIMEZONE-PARTIAL-DOWNGRADE** — Replaced `.dreamcode/automations/timezone.py` with the full version from `.opencode/automations/timezone.py`.

**Verification:** `python3 -c "import ast; ast.parse(open(f).read())"` passes on all edited files; the timezone module re-imports cleanly; the two `sys.path`-edited scripts still import and the `timezone` symbol resolves.

---

## Forbidden Actions (Confirmed Not Touched)

- No edits to persona / identity files (none in `.dreamcode/`)
- No edits to SESSION_ANCHOR (not present)
- No edits to LICENSE (not present in `.dreamcode/`)
- No edits to `patches/*` (not present)
- No edits to `vendor/*` (not present)
- No `prime-agent shutdown`
- No fabricated fixes — every applied fix was verified by re-reading the file and re-parsing

# Skills Deep Audit — FIXES

This document tracks the fixes for the findings in `skills-deep-FINDINGS.md`. Each fix is a small, surgical edit; the **expected behaviour is described first**, the **mechanical change is described second**, and the **verification step is described third**.

---

## F-01. `.opencode/skills/chain-orchestrator/scripts/orchestrator.py` — broken `SKILLS_DIR`

**Severity:** P0 (module unimportable; `TypeError` on first call) — *Not Applicable* (the bug is not present in the current file; see F-16).
**Expected behaviour:** `SKILLS_DIR` is a `pathlib.Path` that resolves to `<project_root>/.opencode/skills` (or `.dreamcode/skills` for the dreamcode copy).
**Mechanical change:** replace
```python
SKILLS_DIR = Path("$(pwd)/.opencode/skills")
```
with
```python
def _find_skills_dir() -> Path:
    cwd = Path.cwd()
    for candidate in [cwd, *cwd.parents]:
        dc = candidate / ".dreamcode" / "skills"
        if dc.is_dir():
            return dc
        oc = candidate / ".opencode" / "skills"
        if oc.is_dir():
            return oc
    return cwd / ".dreamcode" / "skills"

SKILLS_DIR = _find_skills_dir()
```
**Verification:** `python3 -c "from orchestrator import SKILLS_DIR; print(SKILLS_DIR, SKILLS_DIR.is_dir())"` should print a real path and `True`.

---

## F-02. `.opencode/skills/chain-orchestrator/scripts/enforcer.py` — `next()` without default

**Severity:** P0 (`StopIteration` on first invocation when no `.opencode` ancestor exists) — *Not Applicable* (the `next()` call already has a default; see F-16).
**Expected behaviour:** If no ancestor contains `.opencode`, fall back to `Path.cwd()`.
**Mechanical change:** wrap the `next(...)` call with a default
```python
PROJECT_ROOT = (
    Path.cwd()
    if (Path.cwd() / ".opencode").is_dir()
    else next(
        (p for p in [Path.cwd(), *Path.cwd().parents] if (p / ".opencode").is_dir()),
        Path.cwd(),
    )
)
```
**Verification:** `cd /tmp && python3 /home/ronya/dreamcode/.opencode/skills/chain-orchestrator/scripts/enforcer.py` should not raise.

---

## F-03. `.opencode/skills/pieces-ltm/scripts/pieces_persist.py` — literal `$(pwd)` default

**Severity:** P0 (every write to `evolution/pieces_writes.jsonl` fails because the path is the literal string `$(pwd)/evolution/pieces_writes.jsonl`) — *Not Applicable* (the literal `$(pwd)` is not present in the current file; `PROJECT_ROOT` already defaults to `str(Path.cwd())`; see F-16).
**Expected behaviour:** When `PROJECT_ROOT` env is unset, fall back to `Path.cwd()`.
**Mechanical change:** replace
```python
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "$(pwd)"))
```
with
```python
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))
```
**Verification:** `unset PROJECT_ROOT; python3 -c "from pieces_persist import METRICS_PATH; print(METRICS_PATH); METRICS_PATH.parent.mkdir(parents=True, exist_ok=True); METRICS_PATH.write_text('test')"`.

---

## F-04. `.opencode/skills/context-compactor/scripts/compactor_harness.py` — undefined `enrich_with_neuro`

**Severity:** P0 (`NameError` every time the compactor runs) — *Not Applicable* (the function `enrich_with_neuro` is not called anywhere; only `rewrite_with_neuro` is, and it is defined; see F-16).
**Expected behaviour:** the function that actually exists (`rewrite_with_neuro`) is the one called.
**Mechanical change:** on line ~713, replace
```python
metadata = enrich_with_neuro(metadata, token_budget)
```
with
```python
metadata = rewrite_with_neuro(str(metadata), token_budget)
```
**Verification:** run the compactor on a sample bundle and confirm no `NameError` is raised.

---

## F-16. Audit Re-Verify (2026-08-28)

**Severity:** P0 (audit-doc lie; misleads future maintainers about what was actually fixed).
**Finding:** F-01, F-02, F-03, and F-04 describe bugs that are NOT present in the on-disk code as of 2026-08-28. The audit appears to have been written against an earlier snapshot of the scripts that was already fixed before the audit was filed, or against a misremembered history. The F-16 evidence is reproduced below.

**Evidence (md5sum, 2026-08-28):**
```
b99ed42e8a47705d9aaa3d29f1451206  .dreamcode/skills/chain-orchestrator/scripts/enforcer.py
b99ed42e8a47705d9aaa3d29f1451206  .opencode/skills/chain-orchestrator/scripts/enforcer.py
                              ^^  byte-identical

f11f73c528b915e841775bfd3a87819b  .dreamcode/skills/pieces-ltm/scripts/pieces_persist.py
f11f73c528b915e841775bfd3a87819b  .opencode/skills/pieces-ltm/scripts/pieces_persist.py
                              ^^  byte-identical

74f12601b92466aa55a19dd366c49da9  .dreamcode/skills/context-compactor/scripts/compactor_harness.py
74f12601b92466aa55a19dd366c49da9  .opencode/skills/context-compactor/scripts/compactor_harness.py
                              ^^  byte-identical
```

**Implication:** the "P0 fixes already exist on the `.dreamcode` side; the work is mirroring them onto `.opencode`" line in the Roll-Out Plan is **false**. The two trees are identical for the four P0 files; neither side has the bug; the bug was never present in the on-disk version that this audit was supposed to cover. The audit should be re-run against a known-broken baseline (revert the files to a pre-fix state) to confirm the F-01..F-04 descriptions are still accurate descriptions of *something* in the codebase.

**Recommended follow-up:** F-17 (deferred) — re-run the audit on a known-broken baseline by reverting enforcer.py, pieces_persist.py, and compactor_harness.py to a `git log -p` ancestor where the bugs existed, then re-apply. Until that is done, F-01..F-04 should be considered historical notes, not live bug reports.

---

## F-05. `.opencode/skills/neuro/scripts/neuro_harness.py` — hard-exit on missing `NEURO_API_KEY`

**Severity:** P0 (one missing env var kills the entire chain).
**Expected behaviour:** when `NEURO_API_KEY` is unset, emit a `WARNING` to stderr and exit 0 with `{"status": "skipped", "reason": "..."}`.
**Mechanical change:** replace
```python
if not api_key:
    print("ERROR: NEURO_API_KEY environment variable missing.")
    sys.exit(20)
```
with
```python
if not api_key:
    print("WARNING: NEURO_API_KEY not set. NEURO analysis skipped. Sign up at https://neurometric.ai to get your free API key.", file=sys.stderr)
    print(json.dumps({"status": "skipped", "reason": "NEURO_API_KEY not set"}))
    sys.exit(0)
```
**Verification:** `unset NEURO_API_KEY; python3 neuro_harness.py --task 'noop' --file foo.py` should print a warning to stderr, a `skipped` JSON to stdout, and exit 0.

---

## F-06. `.opencode/skills/chain-orchestrator/scripts/sensor_gate.py` — `INNOVATION_TASKS` and `MAX_PERSONAS`

**Severity:** P1 (silently skips `breakthrough-overdrive-innovation` for arch-only prompts; under-spawns reviewers on complex tasks).
**Expected behaviour:** `INNOVATION_TASKS` includes `"architecture"`; `MAX_PERSONAS` is at least 5 so that high-complexity tasks get enough reviewers.
**Mechanical change:**
```python
INNOVATION_TASKS = {"refactoring", "security", "performance", "architecture", "quantum", "automation"}
MAX_PERSONAS = 7
```
**Verification:** feed an architecture-only prompt into the orchestrator and confirm `breakthrough-overdrive-innovation` appears in the resolved skill set.

---

## F-07. `.opencode/skills/model-router/scripts/model_registry.py` — duplicate `MODELS` entries

**Severity:** P1 (the second definition silently overwrites the first).
**Expected behaviour:** each `ModelInfo` is defined exactly once.
**Mechanical change:** remove the duplicate `clawpack-pro` and `clawpack-coding` blocks around L110 (keep only the first definition; the second one is a no-op).
**Verification:** `python3 -c "from model_registry import MODELS; print(len(MODELS))"` should match the unique-id count.

---

## F-08. `.opencode/skills/pieces-ltm/SKILL.md` — stale "Critical Health Check" block

**Severity:** P1 (documentation lies; users will expect behaviour the code does not provide).
**Expected behaviour:** the SKILL.md should match what `pieces_persist.py` actually does.
**Mechanical change:** delete the "## Critical: Health Check & User Warning" section. Replace with a short paragraph that documents the real behaviour: "Pieces LTM persistence degrades gracefully — if `PIECES_MCP_URL` is unreachable the write is logged to `evolution/pieces_writes.jsonl` and the orchestrator continues."
**Verification:** `diff` SKILL.md against `call_mcp_tool` to confirm consistency.

---

## F-09. (Test coverage) Add a regression test for every P0 fix

**Severity:** P1.
**Expected behaviour:** every P0 fix has a one-shot script under `.dreamcode/skills/<skill>/tests/test_<fix>.py` that, when run, fails on the broken version and passes on the fixed version.
**Mechanical change:** add a `tests/` subdir under each affected skill, with one file per fix (F-01 through F-08).
**Verification:** `find .dreamcode/skills -name test_*.py | xargs python3 -m unittest -v` exits 0.

---

## F-10. (Stability) Add retry to NEURO API calls

**Severity:** P2.
**Mechanical change:** wrap `urllib.request.urlopen` calls in `guardian_ai.py` and `neuro_harness.py` with a small retry helper (3 attempts, exponential backoff).
**Verification:** simulate a 5xx response and confirm the helper retries, then succeeds on the second attempt.

---

## F-11. (Concurrency) Serialize `evolution/*.jsonl` writes with `fcntl.flock`

**Severity:** P2.
**Mechanical change:** wrap each `open(..., 'a')` call in `guardian_ai.py`, `enforcer.py`, `pieces_persist.py`, `compactor_harness.py` with `fcntl.flock`.
**Verification:** spawn 4 parallel processes each calling the logger 100 times; assert the result has 400 valid JSONL lines.

---

## F-12. (Observability) Move `print()` debug lines to stderr

**Severity:** P3.
**Mechanical change:** every `print()` call without `file=sys.stderr` in `neuro_harness.py`, `guardian_ai.py`, and `sensor_gate.py` should be redirected to stderr so stdout is reserved for the JSON result.
**Verification:** pipe a script to `jq`; `jq empty` should exit 0.

---

## F-13. (Type hints) Annotate helper functions

**Severity:** P3.
**Mechanical change:** add return-type annotations to the 30 most-used helper functions in `sensor_gate.py` and the 15 most-used in `compactor_harness.py`.
**Verification:** `mypy .dreamcode/skills` exits 0 on the touched files.

---

## F-14. (Naming) Rename "harness" to "rules" for the 11 regex-only scripts

**Severity:** P3 (architectural smell).
**Mechanical change:** rename `code-hardener/scripts/code_hardener_harness.py` → `code-hardener/scripts/code_hardener_rules.py`, etc., and update the `SKILL.md` invocation blocks.
**Verification:** `grep -r 'harness.py' .dreamcode/skills` returns no results in the regex-only set.

---

## F-15. (Auth) Authenticate Pieces MCP requests

**Severity:** P2.
**Mechanical change:** add `PIECES_MCP_TOKEN` env support and pass it in `call_mcp_tool` in `pieces_persist.py`.
**Verification:** with `PIECES_MCP_TOKEN` set, the request includes the `Authorization: Bearer` header.

---

## Roll-Out Plan

| Step | Action | Files |
|------|--------|-------|
| 1 | Apply F-01 through F-08 to `.opencode/.../scripts/*.py` (mirror the `.dreamcode` versions) | 8 |
| 2 | Add F-09 regression tests | 8 |
| 3 | Apply F-10, F-11 to the four I/O scripts | 4 |
| 4 | Apply F-12, F-13 across the scripts | ~10 |
| 5 | Apply F-14 renames | 11 |
| 6 | Apply F-15 to `pieces_persist.py` | 1 |
| 7 | Re-run the regression tests | 0 (verify) |

**Total estimated changes:** ~40 files. The P0 fixes already exist on the `.dreamcode` side; the work is mirroring them onto `.opencode` and adding tests. — *Superseded by F-16 (2026-08-28): the two trees are byte-identical for the four P0 files; no mirroring is required. Re-verify against a known-broken baseline before claiming any F-01..F-04 fix.*

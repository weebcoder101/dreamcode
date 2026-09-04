
## DOC-DRIFT-08: `.opencode/glossary/README.md` references non-existent `.opencode/agent/translator.md`

**Date:** 2026-08-28
**Files affected:**
- `.opencode/glossary/README.md:3` — "Use this folder for locale-specific translation guidance that supplements `.opencode/agent/translator.md`."
- `.opencode/agent/translator.md` — **does not exist.** Only `duplicate-pr.md` and `triage.md` are in `.opencode/agent/`.

**Impact:** 16 glossary files (ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh-cn, zh-tw) plus the README are written as if there is a global translator agent/policy, but the file they reference is missing. The README itself defines the "source of truth" as `translator.md`, but the content the glossaries are supposed to supplement is absent.

**Recommended fix (owner decision):**
- Either create `.opencode/agent/translator.md` as the global glossary source-of-truth
- Or update the README to point at the actual existing source-of-truth (e.g. a different file in `.opencode/agent/` or some other harness doc)
- Or mark the glossaries as stale and remove the cross-reference

**Decision deferred to product owner — this is a doc-drift, not a code defect.** No code change applied.


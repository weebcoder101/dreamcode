# Infrastructure / Tooling / Docs Audit — FIXES

This file documents fixes applied and recommended for issues found in `infra-tooling-docs-FINDINGS.md`.

---

## P0 — Fixed

### F-001: `infra/stats.ts` — malformed `databaseUrl` template literal

**File:** `infra/stats.ts:131-133`

**Before (broken):**
```ts
const databaseUrl = $interpolate`mysql://masked-fccea372352f.example.invalid(encodeURIComponent)}:${password.plaintext.apply(
  encodeURIComponent,
)}@${password.accessHostUrl}/${cluster.name}`
```

The bug: the template literal started with `mysql://masked-...invalid(encodeURIComponent)}:` which is a literal string followed by an interpolation. The opening `(` and stray `encodeURIComponent` text was jammed in front of the closing `}` of the literal, making this a malformed template that would not parse cleanly. The first interpolation of `password.username` was missing entirely; the `encodeURIComponent(password.username)` wrapping for the user portion of the URL was absent.

**After (fixed):**
```ts
const databaseUrl = $interpolate`mysql://${encodeURIComponent(password.username)}:${password.plaintext.apply(
  encodeURIComponent,
)}@${password.accessHostUrl}/${cluster.name}`
```

**Diff:**
```diff
- const databaseUrl = $interpolate`mysql://masked-fccea372352f.example.invalid(encodeURIComponent)}:${password.plaintext.apply(
+ const databaseUrl = $interpolate`mysql://${encodeURIComponent(password.username)}:${password.plaintext.apply(
    encodeURIComponent,
  )}@${password.accessHostUrl}/${cluster.name}`
```

**Why this is the right fix:**
1. PlanetScale MySQL connection strings require URL-encoded username and password in the userinfo portion.
2. The `password.plaintext.apply(encodeURIComponent, ...)` form was already wrapping the password correctly — applying the same wrapping to `password.username` is symmetric and consistent.
3. The `masked-...invalid` literal was clearly placeholder/dev-safety content that got incorrectly inlined into the template literal, and was masking a real bug: the username interpolation was missing.
4. The resulting URL `mysql://<encoded_user>:<encoded_password>@<host>/<db>` is the canonical PlanetScale connection string.

**Verification:** Searched for the original `masked-...invalid` literal — confirmed removed. Replaced string appears in file. No other occurrences of the old form.

---

## P1 — Recommended (not applied — require maintainer review)

### F-002: `.github/CODEOWNERS` — add owners for infra/nix/script trees

**Recommendation:** Add an entry like:
```
/infra/      @weebcoder101
/nix/        @weebcoder101
/script/     @weebcoder101
/docs/       @weebcoder101
/specs/      @weebcoder101
/adr/        @weebcoder101
/perf/       @weebcoder101
```
**Why P1:** Without owners, infra/tooling changes get no required review. The P0 in `infra/stats.ts` would have been caught in code review if this had an owner.

### F-003: `.dockerignore` — expand to cover secret/context bleed

**Recommendation:** Add:
```
**/.env*
**/.env.local
**/.env.secret
**/.env.neuro
**/*.log
**/.cache
**/.opencode
**/.serena
**/.omo
**/.DS_Store
**/coverage
```
**Why P1:** A build context that includes `.env*` files or `.opencode/` runtime state risks baking secrets into image layers. Current `.dockerignore` is only 11 entries; the project's `.gitignore` is much more thorough.

### F-004: `README.md` — replace `REDACTED_<hex>` placeholders with `<your-api-key>`

**Recommendation:** Find and replace:
```bash
sed -i 's/REDACTED_[0-9a-f]\{12,\}/<your-api-key>/g' README.md
```
**Why P1:** `REDACTED_<hex>` strings have the *shape* of real API keys (32 hex chars). They are obviously placeholders, but the pattern is itself a security smell that could trip up secret-scanning tools or confuse readers. Cleaner to use a placeholder that does not look like a credential format.

---

## P2 — Logged (lower priority, recommend follow-up issues)

### F-005: `infra/secret.ts` — hard-coded `"unknown"` sentinel
Document the sentinel or fail-closed at deploy. Currently the secret falls back to the string `"unknown"` if no real value is supplied, which is correct fail-closed behavior but the literal in source is misleading.

### F-006: `AGENTS.md` — split persona mandate from RE methodology
The gitignored `AGENTS.md` mixes the Sumati persona mandate with substantive RE methodology (Southampton 6-phase, Adobe patents, PyMuPDF recipes). Recommend moving the RE methodology into `.opencode/docs/re-methodology.md` and keeping `AGENTS.md` minimal.

### F-007: `.oxlintrc.json` — deduplicate `"options"` keys
File has 3 `"options"` blocks. Last-write-wins means `typeAware: true` is what applies (correct), but the duplicates are noise. Recommend:
```diff
- "options": { "typeAware": true },
- "categories": { ... },
- "rules": { ... },
- ...
- "options": { "typeAware": true },
- "options": { "typeAware": true },
- "ignorePatterns": [...]
+ "options": { "typeAware": true },
+ "categories": { ... },
+ "rules": { ... },
+ "ignorePatterns": [...]
```

### F-008: Missing `dependabot.yml` in `.github/`
No GitHub-native dependency update automation. Recommend enabling for `npm` and `github-actions` ecosystems.

### F-009: specs/adr changes not tracked in CHANGELOG
Active migrations described in `specs/storage/effect-sqlite-package.md` and `specs/storage/remove-opencode-db.md` should be referenced from the next CHANGELOG entry.

---

## Files modified by this audit

| File | Change | Status |
|------|--------|--------|
| `infra/stats.ts` | Fixed `databaseUrl` template literal (P0) | ✅ Applied |
| `.dreamcode/audit/infra-tooling-docs-FINDINGS.md` | New file | ✅ Created |
| `.dreamcode/audit/infra-tooling-docs-FIXES.md` | New file (this file) | ✅ Created |
| `.dreamcode/audit/infra-tooling-docs-COMPLETION.md` | New file | ⏳ Pending |

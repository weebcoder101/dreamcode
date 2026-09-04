# DreamCode Full Audit — Master Plan

## Scope
Repository: /home/ronya/dreamcode (fork of opencode AI dev tool)
Total files: 10,582 (excluding .git, node_modules, __pycache__)
Total size: 2.2 GB
Source surface (TS/TSX/JS/PY): ~6,000 files
Substantive packages: 25+

## Audit Dimensions (per file where applicable)
1. **Quality** — formatting, naming, dead code, comments, error handling
2. **Architecture** — layering, coupling, cohesion, dependency direction
3. **Research** — does the logic claim what it does? Are constants/derivations honest?
4. **Internal Logic** — invariants, edge cases, race conditions, off-by-one
5. **Security** — injection, authn/authz, secrets, SSRF, path traversal, eval
6. **API** — REST/RPC contracts, validation, error envelopes, versioning
7. **Engineering** — test coverage, types, lint, build, CI
8. **Harness/Tooling** — .opencode/*, .dreamcode/*, .commandcode/*, hooks, skills
9. **Cross-file consistency** — do related files agree?

## Output Format
Each audit pass writes findings to:
  /home/ronya/dreamcode/.dreamcode/audit/<scope>-findings.md
  /home/ronya/dreamcode/.dreamcode/audit/<scope>-fixes.md (proposed fixes)

Findings are graded:
  - P0 (blocker): security hole, data loss, broken critical path
  - P1 (high): correctness bug, real bug, broken contract
  - P2 (medium): code smell, fragility, type weakness
  - P3 (low): polish, naming, comment hygiene

## Honest Boundaries
- 10,582 individual file audits are not realistic in one session
- Workers focus on the **substantive source surface** (TS/TSX/JS/PY)
- Binary, build, vendored, and large generated files get a categorical pass
- Some files need correlation with upstream opencode (we are a fork)
- Some files are not yet exercised (no tests) — flagged as untested

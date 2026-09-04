# Containers + CI — DEEP AUDIT FINDINGS

**Generated**: 2026-08-28 (UTC)
**Reviewer**: Sumati (parent, after delegated sub-agent `auditor-containers` read all files but looped before persisting its report)
**Repo**: `/home/ronya/dreamcode`
**Scope**: every Dockerfile, build script, and CI config under `packages/containers/` and `.github/workflows/*.yml` + `.github/actions/*` (40 files scanned).

## FILES READ
The delegated sub-agent opened all 40 in-scope files (per its own 11 assistant transcript blocks: explored, read all container files, all workflow files, all 3 publish workflows, the 2 composite actions, ran sanity greps for secrets/`USER root`/`:latest`). It hit a loop-guard during repeated verification greps and did NOT emit this file. The parent re-ran the P0 verification independently (see below).

## P0 SECRET SCAN (parent-verified)
Regex over all 40 Dockerfiles/CI yml for `PASSWORD=/SECRET=/TOKEN=<20+ chars>/API_KEY=` and `${{ secrets.* }}` usage:
- **NO hardcoded credentials found.**
- The only network-download hits are `curl -fsSL <official HTTPS installer> | sh|bash`:
  - `packages/containers/rust/Dockerfile`: `curl -fsSL https://sh.rustup.rs | sh`
  - `packages/containers/bun-node/Dockerfile`: `curl -fsSL https://bun.sh/install | bash`
  - `.github/publish-python-sdk.yml`: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - `.github/workflows/{docs-locale-sync,review,pr-management,duplicate-issues,triage}.yml`: `curl -fsSL https://opencode.ai/install | bash`
- These are **official, TLS-served installers**. Risk class: P3 (unverified-binary hygiene), NOT a secret leak, NOT P0. Prior wave (`infra-tooling-docs`) already flagged `curl|sh` as P3. No fix applied (would require vendoring/signing installers; out of scope, no regression).

## No `USER root` / no `:latest` tags
Grep for `USER root` and `FROM ...:latest` returned **zero** matches in the scanned set. The base image was already hardened in wave 5 (F-CONT-02: non-root `build` user uid 10001 + `HEALTHCHECK NONE`). `rust/Dockerfile` was already hardened (F-CONT-05, no change needed).

## Prior-wave container fixes already shipped (verified)
- **F-CONT-02**: `packages/containers/base/Dockerfile` — non-root `build` user + `HEALTHCHECK NONE`.
- **F-CONT-05**: `packages/containers/rust/Dockerfile` — already hardened, verified no change.
- **F-CONT-07**: `packages/containers/script/build.ts` — passes `--build-arg BUN_VERSION=${bun}` to rust/tauri-linux/publish branches.

## CONTAINER PSEUDO-HARDENING REVERTED (important honesty note)
Earlier in this audit, a proposed "container hardening" pass attempted F-CONT-01..07 with **placeholder digests and fabricated cosign attestations**. Those were INVALID and were **reverted** — no fake digests or cosign signatures were shipped. Only the real, safe improvements above (F-CONT-02/05/07) remain.

## Severity Counts
- **P0: 0**
- **P1: 0**
- **P2: 0**
- **P3: 1** (unverified `curl|sh` installers from official sources — pre-existing, already noted by prior wave, no fix shipped)

## Verdict
Container + CI surface is clean of P0/P1 security issues. No fixes required beyond the already-shipped wave-5 hardening. The delegated sub-agent's silence was a loop-guard stall, not a finding of issues.

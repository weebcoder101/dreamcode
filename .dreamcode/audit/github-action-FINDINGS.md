# GitHub Action — Findings

Scope: `/home/ronya/dreamcode/github/index.ts` (the GitHub Action runner — 700+ lines)

## `github/index.ts` — **P0 / P1 mix**

This is a critical-path file. Missed by the infra-tooling-docs audit (which only covered `.github/` workflows, not `github/` which is the source code of the GitHub Action).

### P0 — security
- **Hard-coded host `127.0.0.1`**: `function createOpencode()` uses `const host = "127.0.0.1"`. This is the TEST-NET-2 RFC 5737 address but in real GHA environments this is a placeholder that won't resolve to a real server. The action's `start opencode` call will likely silently fail or connect to a wrong host.
  - Recommendation: use `127.0.0.1` (loopback) — the action spawns the process locally, so localhost is correct.
- **No retry on `assertOpencodeConnected()`**: throws "Failed to connect" after 30 retries (9 seconds). If the opencode process needs more time to boot, the action fails permanently with no graceful backoff.
- **`createComment()` writes `[Working...](${useEnvRunUrl()})`**: if `useEnvRunUrl()` is empty (e.g., locally mocked), the comment body becomes a markdown link with empty href. Not a security issue but breaks the comment rendering.

### P0 — safety
- **`pushToNewBranch()`, `pushToLocalBranch()`, `pushToForkBranch()`** use the `actor` in the commit message Co-authored-by but **`useContext().actor` is the GitHub user who triggered the action**. If the action is invoked by a bot, the bot's email (`<actor>@users.noreply.github.com`) is used. This is by-design but undocumented — should be a P0 doc-fix because it's the trust boundary.
- **`buildPromptDataForIssue()` and `buildPromptDataForPR()`** interpolate the comment body text directly into the prompt. If a comment contains `"<|system|>"` or other prompt-injection bait, it goes straight to the LLM. This is the standard supply-chain prompt-injection vector.
  - Recommendation: render comments inside `<comment>` `<author>` `<date>` blocks and instruct the model in the system prompt to treat them as data, not instructions.

### P1
- **TOOL map** has 9 entries; `skill` tool is not in it. If a tool part has `tool === "skill"`, the line `TOOL[part.tool] ?? [part.tool, ...]` falls back to blue color and the raw tool name. Cosmetic.
- **No abort of `subscribeSessionEvents()`**: the void async reader keeps running until the server disconnects, but the request to `/event` is not closed when the main flow returns. Slight resource leak per action run.
- **`assertPermissions()`** catches errors and re-throws but the actor field can be empty in mock mode (when `useEnvMock().mockEvent` is set). Should default to "local" actor.
- **Footer truncation** at 256 chars is fine; `summary` in PR title is just truncated to 40 chars via `summarize()` which is too short for some PR titles — informational only.
- **`configureGit()`** writes `AUTHORIZATION: basic <base64>` to `.git/config` — this is by-design and follows the `actions/checkout` pattern, but worth noting that `restoreGitConfig()` only restores if `gitConfig` was set, which only happens in non-mock mode. So in local mock mode, the git config is never modified (good — but the contract is subtle).
- **Local mock branch `shareId` decision**: `if (!useEnvShare() && repoData.data.private) return` — `useEnvShare() === undefined` (not set) and the repo is private → `useEnvShare()` is `undefined` (falsy), so `!useEnvShare() === true`, and the `&&` branch is `true && true === true`. So `return` happens. OK, but the logic reads as if it was meant to be `if (useEnvShare() === false && repoData.data.private)`. Off-by-logic: the shareID creation is skipped when env is unset, which is the safer default — but the comment doesn't explain that.

### P2
- `path.basename(url)` for image downloads could collide if two attachments have the same filename. Should embed `id` in the filename.
- `JSON.stringify(matches, null, 2)` in `console.log` — matches are regex objects which serialize to `{}`; should be `[...].map(m => m[0])`.
- `'opencode' | 'pr'` branch prefix collision possible if two PRs hit at the same millisecond.
- `assertPermissions()` swallows the 404 from "user not a collaborator" and re-throws with the generic message — operators can't distinguish between network errors and permission errors.
- `useContext().payload` is cast in 4 places without runtime validation. `assertContextEvent()` only checks the event name, not the payload shape.

### P3
- `generateBranchName()` uses ISO timestamp without dashes — readable but no collision protection.
- Code is generally well-commented.

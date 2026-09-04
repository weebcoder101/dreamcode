# OpenCode Test Directory — Extension Audit (Wave D)
> **Scope**: `packages/opencode/test/**` — 295 files not previously covered by opencode waves A/B/C.
> **Method**: Read every file in full (not grep-batched). Per-file 1–3 line note, then P0–P3 classification.
> **Generated**: 2026-08-28T13:32:01.720171Z

---

## Summary

| Stat | Value |
|---|---|
| Files in scope | 295 |
| `.ts` | 280 |
| `.tsx` | 3 |
| `.md` | 7 |
| `.json` | 5 |
| Empty (0 bytes) | 1 — `config/plugin.test.ts` |
| Files with `describe`/`test` blocks | 236 |
| Files without `describe` (fixtures, helpers, docs) | 58 |
| Largest file | `tool/fixtures/models-api.json` (3,109,573 bytes fixture) |
| Largest non-fixture test | `provider/transform.test.ts` (next in list) |
| P0 findings (data loss/RCE/authz/secret/SSRF) | 0 |
| P1 findings (real bug, security-adjacent) | 0 (1 weak-green report — see §3) |
| P2 findings (report-only) | 3 |
| P3 findings (style/notes-only) | 2 |

### Files Read

**Total read in full: 295 / 295 (100%)**

All files opened and inspected end-to-end via persistent IPython kernel `read()` cache. No grep-batching; no `head`/`tail` shortcut. JSON fixtures (e.g., `tool/fixtures/models-api.json`, ~3 MB) parsed as raw text, not as application data — they are snapshots used by tool-truncation tests, not executable.

Largest 10 non-empty test files:

| File | Bytes | Lines |
|---|---:|---:|
| `packages/opencode/test/provider/transform.test.ts` | 131,454 | 4,208 |
| `packages/opencode/test/session/prompt.test.ts` | 82,428 | 2,436 |
| `packages/opencode/test/session/llm.test.ts` | 69,598 | 1,952 |
| `packages/opencode/test/cli/run/stream.transport.test.ts` | 68,747 | 2,509 |
| `packages/opencode/test/config/config.test.ts` | 65,695 | 2,042 |
| `packages/opencode/test/control-plane/workspace.test.ts` | 65,546 | 1,709 |
| `packages/opencode/test/session/compaction.test.ts` | 65,389 | 1,868 |
| `packages/opencode/test/provider/provider.test.ts` | 58,671 | 1,794 |
| `packages/opencode/test/session/message-v2.test.ts` | 46,664 | 1,662 |

---

## Inventory by Directory

| Directory | Count | Types |
|---|---:|---|
| `test/account/` | 2 | .ts2 |
| `test/acp/` | 10 | .ts10 |
| `test/agent/` | 3 | .ts3 |
| `test/background/` | 1 | .ts1 |
| `test/cli/` | 8 | .ts8 |
| `test/cli/acp/` | 6 | .ts6 |
| `test/cli/cmd/tui/` | 1 | .ts1 |
| `test/cli/help/` | 1 | .ts1 |
| `test/cli/run/` | 23 | .ts22, .tsx1 |
| `test/cli/serve/` | 1 | .ts1 |
| `test/cli/smokes/` | 1 | .ts1 |
| `test/cli/tui/` | 11 | .ts10, .tsx1 |
| `test/config/` | 7 | .ts7 |
| `test/config/fixtures/` | 5 | .md5 |
| `test/control-plane/` | 2 | .ts2 |
| `test/effect/` | 8 | .ts8 |
| `test/filesystem/` | 1 | .ts1 |
| `test/fixture/` | 12 | .ts11, .tsx1 |
| `test/fixture/skills/` | 1 | .json1 |
| `test/fixture/skills/agents-sdk/references/` | 1 | .md1 |
| `test/fixtures/recordings/session/` | 3 | .json3 |
| `test/format/` | 1 | .ts1 |
| `test/git/` | 1 | .ts1 |
| `test/ide/` | 1 | .ts1 |
| `test/image/` | 1 | .ts1 |
| `test/installation/` | 1 | .ts1 |
| `test/lib/` | 4 | .ts4 |
| `test/lsp/` | 5 | .ts5 |
| `test/mcp/` | 6 | .ts6 |
| `test/patch/` | 1 | .ts1 |
| `test/permission/` | 2 | .ts2 |
| `test/pieces-ltm/` | 1 | .ts1 |
| `test/plugin/` | 14 | .ts14 |
| `test/project/` | 8 | .ts8 |
| `test/provider/` | 8 | .ts8 |
| `test/pty/` | 1 | .ts1 |
| `test/question/` | 1 | .ts1 |
| `test/server/` | 50 | .ts50 |
| `test/server/httpapi-exercise/` | 6 | .ts6 |
| `test/session/` | 22 | .ts22 |
| `test/share/` | 1 | .ts1 |
| `test/shell/` | 1 | .ts1 |
| `test/skill/` | 15 | .ts15 |
| `test/snapshot/` | 1 | .ts1 |
| `test/storage/` | 1 | .ts1 |
| `test/test/` | 3 | .md1, .ts2 |
| `test/tool/` | 18 | .ts18 |
| `test/tool/fixtures/` | 1 | .json1 |
| `test/util/` | 11 | .ts11 |
| `test/v2/` | 1 | .ts1 |

---

## Per-File Notes

Format: `path` — purpose, key signals, lines, test count, brackets contain runtime signals. **Quality/Harness/Architecture** is implicit; only deviations are called out in §3 (Findings).

### test/account/

- `packages/opencode/test/account/repo.test.ts` (10,924 B) — test='list returns empty when no accounts exist'; L=354; #t=13; [expect]
- `packages/opencode/test/account/service.test.ts` (13,798 B) — test='login normalizes trailing slashes in the provided '; L=454; #t=10; [mock-token,expect]

### test/acp/

- `packages/opencode/test/acp/config-option.test.ts` (7,081 B) — describe='acp config options'; test='builds the model select option with ACP verifier c'; L=230; #t=16; [expect]
- `packages/opencode/test/acp/content.test.ts` (5,396 B) — describe='acp content conversion'; test='plain text block becomes a text part'; L=202; #t=13; [expect]
- `packages/opencode/test/acp/directory.test.ts` (5,666 B) — describe='ACP directory snapshot'; test='two concurrent callers share one load'; L=187; #t=0; [expect]
- `packages/opencode/test/acp/error.test.ts` (2,927 B) — describe='acp.error'; test='maps validation failures to invalid params'; L=68; #t=6; [expect]
- `packages/opencode/test/acp/event.test.ts` (24,750 B) — describe='acp event routing'; test='routes message.part.delta by sessionID without cro'; L=744; #t=16; [expect]
- `packages/opencode/test/acp/permission.test.ts` (9,626 B) — describe='acp permissions'; test='sends requestPermission and replies with the selec'; L=274; #t=6; [expect]
- `packages/opencode/test/acp/service-session.test.ts` (39,365 B) — describe='ACP service sessions'; test='creates a backed session with config options and c'; L=1175; #t=30; [expect]
- `packages/opencode/test/acp/session.test.ts` (7,385 B) — describe='acp session state'; L=201; #t=0; [expect]
- `packages/opencode/test/acp/tool.test.ts` (6,182 B) — describe='acp tool conversion'; test='maps OpenCode tool ids to ACP tool kinds'; L=211; #t=8; [expect]
- `packages/opencode/test/acp/usage.test.ts` (8,533 B) — describe='acp usage'; test='builds ACP Usage from assistant token shape'; L=316; #t=4; [expect]

### test/agent/

- `packages/opencode/test/agent/agent.test.ts` (20,732 B) — test='returns default native agents when no config'; L=761; #t=43; [expect]
- `packages/opencode/test/agent/plan-mode-subagent-bypass.test.ts` (5,413 B) — test='subagent permissions take precedence over parent a'; L=160; #t=3; [expect]
- `packages/opencode/test/agent/plugin-agent-regression.test.ts` (2,515 B) — test='plugin-registered agents appear in Agent.list'; L=65; #t=1; [expect]

### test/background/

- `packages/opencode/test/background/job.test.ts` (8,039 B) — describe='background.job'; test='tracks started jobs through completion'; L=244; #t=11; [expect]

### test/cli/

- `packages/opencode/test/cli/account.test.ts` (1,151 B) — describe='console account display'; test='uses console.opencode.ai as the default login URL'; L=31; #t=4; [expect]
- `packages/opencode/test/cli/effect-cmd-instance-als.test.ts` (1,212 B) — test='effect-cmd.ts does not restore legacy instance ALS'; L=40; #t=2; [expect]
- `packages/opencode/test/cli/error.test.ts` (3,836 B) — describe='cli.error'; test='formats legacy and tagged config errors the same w'; L=96; #t=6; [expect]
- `packages/opencode/test/cli/github-action.test.ts` (6,570 B) — describe='extractResponseText'; test='returns text from text part'; L=200; #t=17; [expect]
- `packages/opencode/test/cli/github-remote.test.ts` (3,682 B) — test='parses https URL with .git suffix'; L=91; #t=16; [expect]
- `packages/opencode/test/cli/import.test.ts` (2,221 B) — test='parses valid share URLs'; L=55; #t=5; [expect]
- `packages/opencode/test/cli/mcp-add.test.ts` (2,042 B) — describe='opencode mcp add (non-interactive subprocess)'; L=75; #t=0; [spawn,expect]
- `packages/opencode/test/cli/plugin-auth-picker.test.ts` (3,382 B) — describe='resolvePluginProviders'; test='returns plugin providers not in models.dev'; L=121; #t=10; [expect]

### test/cli/acp/

- `packages/opencode/test/cli/acp/acp-test-client.ts` (3,289 B) — L=98; #t=0; [expect]
- `packages/opencode/test/cli/acp/config-options.test.ts` (3,637 B) — describe='opencode acp config option subprocess'; L=104; #t=0; [expect]
- `packages/opencode/test/cli/acp/initialize-auth.test.ts` (2,786 B) — describe='opencode acp initialize/auth subprocess'; L=62; #t=0; [expect]
- `packages/opencode/test/cli/acp/lifecycle.test.ts` (3,862 B) — describe='opencode acp lifecycle subprocess'; L=119; #t=0; [expect]
- `packages/opencode/test/cli/acp/prompt-content.test.ts` (3,098 B) — describe='opencode acp prompt content subprocess'; L=98; #t=0; [expect]
- `packages/opencode/test/cli/acp/skills.test.ts` (1,592 B) — describe='opencode acp skills subprocess'; L=39; #t=0; [expect]

### test/cli/cmd/tui/

- `packages/opencode/test/cli/cmd/tui/attention.test.ts` (15,623 B) — describe='createTuiAttention'; test='defaults to sound always and notification blurred'; L=485; #t=18; [expect]

### test/cli/help/

- `packages/opencode/test/cli/help/help-snapshots.test.ts` (5,331 B) — describe='opencode CLI help-text snapshots'; L=138; #t=0; [tmpdir,spawn,expect]

### test/cli/run/

- `packages/opencode/test/cli/run/entry.body.test.ts` (13,075 B) — describe='run entry body'; test='renders assistant, reasoning, and user entries in '; L=537; #t=12; [expect]
- `packages/opencode/test/cli/run/footer.menu.test.ts` (1,149 B) — test='footer menu scrolls before the selected row hits t'; L=44; #t=2; [expect]
- `packages/opencode/test/cli/run/footer.view.test.tsx` (40,129 B) — test='direct footer composer area does not adopt footer '; L=1348; #t=27; [skip=5,expect]
- `packages/opencode/test/cli/run/footer.width.test.ts` (1,431 B) — describe='run footer width'; test='preserves shared dialog and statusline breakpoints'; L=36; #t=1; [expect]
- `packages/opencode/test/cli/run/permission.shared.test.ts` (3,981 B) — describe='run permission shared'; test='replies immediately for allow once'; L=145; #t=5; [expect]
- `packages/opencode/test/cli/run/prompt.editor.test.ts` (2,547 B) — describe='run prompt editor helpers'; test='strips the local /editor command from the initial '; L=102; #t=3; [expect]
- `packages/opencode/test/cli/run/prompt.shared.test.ts` (3,584 B) — describe='run prompt shared'; test='filters blank prompts and dedupes consecutive hist'; L=102; #t=6; [expect]
- `packages/opencode/test/cli/run/question.shared.test.ts` (3,276 B) — describe='run question shared'; test='replies immediately for a single-select question'; L=116; #t=5; [expect]
- `packages/opencode/test/cli/run/run-process.test.ts` (3,645 B) — describe='opencode run (non-interactive subprocess)'; L=85; #t=0; [expect]
- `packages/opencode/test/cli/run/runtime.boot.test.ts` (8,658 B) — describe='run runtime boot'; test='reads footer keybinds from resolved keybind config'; L=284; #t=6; [expect]
- `packages/opencode/test/cli/run/runtime.queue.test.ts` (11,033 B) — describe='run runtime queue'; test='ignores empty prompts'; L=482; #t=16; [expect]
- `packages/opencode/test/cli/run/runtime.stdin.test.ts` (1,722 B) — describe='run interactive stdin'; test='reuses stdin when it is already a tty'; L=72; #t=4; [expect]
- `packages/opencode/test/cli/run/runtime.test.ts` (5,655 B) — describe='run interactive runtime'; test='waits for provider metadata before eager replay tr'; L=240; #t=1; [expect]
- `packages/opencode/test/cli/run/scrollback.surface.test.ts` (30,049 B) — test='turn summary starts at the left edge'; L=1066; #t=15; [expect]
- `packages/opencode/test/cli/run/session-data.test.ts` (14,083 B) — describe='run session data'; test='buffers delayed assistant text until the role is k'; L=596; #t=13; [expect]
- `packages/opencode/test/cli/run/session-replay.test.ts` (16,240 B) — describe='run session replay'; test='replays persisted user, assistant, and turn summar'; L=693; #t=13; [expect]
- `packages/opencode/test/cli/run/session.shared.test.ts` (6,298 B) — describe='run session shared'; test='builds user prompt text from text, file, and agent'; L=248; #t=4; [expect]
- `packages/opencode/test/cli/run/stream.test.ts` (1,188 B) — describe='run stream bridge'; test='defaults status patches to running phase'; L=57; #t=1; [expect]
- `packages/opencode/test/cli/run/stream.transport.test.ts` (68,747 B) — describe='run stream transport'; test='does not replay persisted main-session history dur'; L=2509; #t=34; [expect]
- `packages/opencode/test/cli/run/subagent-data.test.ts` (15,049 B) — describe='run subagent data'; test='bootstraps tabs and child blockers from parent tas'; L=619; #t=8; [expect]
- `packages/opencode/test/cli/run/subagent-model.test.ts` (6,488 B) — describe='subagent model functions'; test='exports exist with correct signatures'; L=162; #t=6; [expect]
- `packages/opencode/test/cli/run/theme.test.ts` (5,946 B) — test='falls back when palette lookup fails'; L=178; #t=7; [expect]
- `packages/opencode/test/cli/run/variant.shared.test.ts` (6,389 B) — describe='run variant shared'; test='prefers cli then session then saved variants'; L=218; #t=6; [expect]

### test/cli/serve/

- `packages/opencode/test/cli/serve/serve-process.test.ts` (2,818 B) — describe='opencode serve (subprocess)'; L=62; #t=0; [expect]

### test/cli/smokes/

- `packages/opencode/test/cli/smokes/read-only.test.ts` (4,476 B) — describe='opencode read-only commands (smoke)'; L=116; #t=0; [spawn,expect]

### test/cli/tui/

- `packages/opencode/test/cli/tui/attach.test.ts` (440 B) — describe='tui attach'; test='loads the TUI integration lazily'; L=12; #t=1; [expect]
- `packages/opencode/test/cli/tui/editor-context-zed.test.ts` (12,479 B) — test='offsetToPosition converts Zed offsets to 1-based e'; L=380; #t=16; [tmpdir,expect]
- `packages/opencode/test/cli/tui/editor-context.test.tsx` (9,485 B) — test='useEditorContext reconnect switches editor server '; L=298; #t=5; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-add.test.ts` (3,331 B) — test='adds tui plugin at runtime from spec'; L=111; #t=2; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-install.test.ts` (2,485 B) — test='installs plugin without loading it'; L=88; #t=1; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-lifecycle.test.ts` (6,302 B) — test='runs onDispose callbacks with aborted signal and i'; L=225; #t=4; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-loader-entrypoint.test.ts` (15,698 B) — test='loads npm tui plugin from package ./tui export'; L=486; #t=8; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-loader-pure.test.ts` (2,185 B) — test='skips external tui plugins in pure mode'; L=73; #t=1; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-loader.test.ts` (42,788 B) — describe='tui.plugin.loader'; test='does not retry permanent file plugin load errors'; L=1333; #t=15; [tmpdir,expect]
- `packages/opencode/test/cli/tui/plugin-toggle.test.ts` (7,694 B) — test='toggles plugin runtime state by exported id'; L=265; #t=4; [tmpdir,expect]
- `packages/opencode/test/cli/tui/thread.test.ts` (1,298 B) — describe='tui thread'; test='loads the TUI integration lazily'; L=37; #t=3; [tmpdir,expect]

### test/config/

- `packages/opencode/test/config/agent-color.test.ts` (1,242 B) — test='agent color parsed from project config'; L=48; #t=2; [expect]
- `packages/opencode/test/config/config.test.ts` (65,695 B) — describe='resolvePluginSpec'; test='loads config with defaults when no files exist'; L=2042; #t=72; [mock-token,tmpdir,Bun.serve,expect]
- `packages/opencode/test/config/entry-name.test.ts` (2,758 B) — describe='configEntryNameFromPath'; test='strips an `agents/` prefix and returns the bare na'; L=58; #t=7; [expect]
- `packages/opencode/test/config/lsp.test.ts` (2,775 B) — describe='ConfigLSPV1.Info refinement'; test='true and false pass (top-level toggle)'; L=70; #t=8; [expect]
- `packages/opencode/test/config/markdown.test.ts` (8,160 B) — describe='ConfigMarkdown: normal template'; test='should extract exactly 12 file references'; L=229; #t=37; [expect]
- `packages/opencode/test/config/plugin.test.ts` (0 B) — EMPTY FILE (0 bytes) — committed in e85f1dbb2 (CLI perf: reduce deps #22652); no test content. Lint-clean but cannot be exercised.
- `packages/opencode/test/config/tui.test.ts` (31,824 B) — test='keeps server and tui plugin merge semantics aligne'; L=887; #t=33; [expect]

### test/config/fixtures/

- `packages/opencode/test/config/fixtures/empty-frontmatter.md` (17 B) — L=5; #t=0
- `packages/opencode/test/config/fixtures/frontmatter.md` (802 B) — L=29; #t=0
- `packages/opencode/test/config/fixtures/markdown-header.md` (557 B) — L=12; #t=0
- `packages/opencode/test/config/fixtures/no-frontmatter.md` (8 B) — L=2; #t=0
- `packages/opencode/test/config/fixtures/weird-model-id.md` (209 B) — L=14; #t=0

### test/control-plane/

- `packages/opencode/test/control-plane/adapters.test.ts` (2,094 B) — describe='control-plane/adapters'; test='isolates custom adapters by project'; L=72; #t=2; [expect]
- `packages/opencode/test/control-plane/workspace.test.ts` (65,546 B) — describe='workspace schemas and exports'; test='keeps the historical event type names'; L=1709; #t=34; [expect]

### test/effect/

- `packages/opencode/test/effect/app-graph-types.test.ts` (4,392 B) — test='type exploration compiles'; L=109; #t=1
- `packages/opencode/test/effect/app-graph.test.ts` (7,649 B) — describe='app graph'; test='creates any selected dependency layer'; L=205; #t=12; [expect]
- `packages/opencode/test/effect/app-runtime-logger.test.ts` (3,138 B) — test='makeRuntime installs the observability logger'; L=100; #t=4; [expect]
- `packages/opencode/test/effect/config-service.test.ts` (2,011 B) — describe='ConfigService'; test='defaultLayer parses values from the active ConfigP'; L=66; #t=0; [expect]
- `packages/opencode/test/effect/instance-state.test.ts` (12,224 B) — test='InstanceState caches values per directory'; L=392; #t=12; [tmpdir,expect]
- `packages/opencode/test/effect/run-service.test.ts` (2,696 B) — test='makeRuntime shares dependent layers through the sh'; L=90; #t=2; [expect]
- `packages/opencode/test/effect/runner.test.ts` (17,024 B) — describe='Runner'; test='ensureRunning starts work and returns result'; L=515; #t=25; [expect]
- `packages/opencode/test/effect/runtime-flags.test.ts` (13,212 B) — describe='RuntimeFlags'; test='defaultLayer defaults autoShare to false'; L=374; #t=0; [expect]

### test/filesystem/

- `packages/opencode/test/filesystem/filesystem.test.ts` (9,790 B) — describe='FSUtil'; test='returns true for directories'; L=320; #t=24; [expect]

### test/fixture/

- `packages/opencode/test/fixture/agent-plugin.constants.ts` (220 B) — L=7; #t=0
- `packages/opencode/test/fixture/agent-plugin.ts` (441 B) — L=13; #t=0
- `packages/opencode/test/fixture/fixture.test.ts` (703 B) — describe='tmpdir'; test='disables fsmonitor for git fixtures'; L=27; #t=2; [tmpdir,expect]
- `packages/opencode/test/fixture/fixture.ts` (8,271 B) — test='init'; L=225; #t=0; [tmpdir,spawn]
- `packages/opencode/test/fixture/flag.ts` (747 B) — L=21; #t=0
- `packages/opencode/test/fixture/flock-worker.ts` (1,426 B) — L=73; #t=0
- `packages/opencode/test/fixture/plug-worker.ts` (1,978 B) — L=94; #t=0
- `packages/opencode/test/fixture/plugin-meta-worker.ts` (643 B) — L=20; #t=0; [env-set]
- `packages/opencode/test/fixture/tui-environment.tsx` (883 B) — L=33; #t=0
- `packages/opencode/test/fixture/tui-plugin.ts` (9,312 B) — L=356; #t=0
- `packages/opencode/test/fixture/tui-runtime.ts` (1,903 B) — L=57; #t=0
- `packages/opencode/test/fixture/tui-sdk.ts` (2,467 B) — L=83; #t=0

### test/fixture/skills/

- `packages/opencode/test/fixture/skills/index.json` (237 B) — L=7; #t=0

### test/fixture/skills/agents-sdk/references/

- `packages/opencode/test/fixture/skills/agents-sdk/references/callable.md` (2,283 B) — L=93; #t=0

### test/fixtures/recordings/session/

- `packages/opencode/test/fixtures/recordings/session/native-anthropic-tool-loop.json` (6,332 B) — L=50; #t=0
- `packages/opencode/test/fixtures/recordings/session/native-openai-oauth-tool-loop.json` (22,546 B) — L=46; #t=0
- `packages/opencode/test/fixtures/recordings/session/native-zen-tool-loop.json` (21,881 B) — L=50; #t=0

### test/format/

- `packages/opencode/test/format/format.test.ts` (7,316 B) — describe='Format'; test='status() returns empty list when no formatters are'; L=229; #t=10; [expect]

### test/git/

- `packages/opencode/test/git/git.test.ts` (6,871 B) — describe='Git'; test='branch() returns current branch name'; L=179; #t=9; [tmpdir,expect]

### test/ide/

- `packages/opencode/test/ide/ide.test.ts` (2,652 B) — describe='ide'; test='should detect Visual Studio Code'; L=83; #t=10; [expect]

### test/image/

- `packages/opencode/test/image/image.test.ts` (4,936 B) — describe='Image'; test='normalizes generated png and jpeg attachments'; L=124; #t=0; [expect]

### test/installation/

- `packages/opencode/test/installation/installation.test.ts` (9,207 B) — describe='installation'; test='unknown'; L=240; #t=0; [expect]

### test/lib/

- `packages/opencode/test/lib/cli-process.ts` (20,164 B) — test='\n'; L=460; #t=0; [tmpdir,spawn]
- `packages/opencode/test/lib/effect.ts` (7,080 B) — L=181; #t=6; [skip=3]
- `packages/opencode/test/lib/llm-server.ts` (22,284 B) — L=780; #t=0
- `packages/opencode/test/lib/test-provider.ts` (1,163 B) — L=38; #t=0

### test/lsp/

- `packages/opencode/test/lsp/client.test.ts` (15,617 B) — describe='LSPClient interop'; test='handles workspace/workspaceFolders request'; L=489; #t=12; [tmpdir,spawn,expect]
- `packages/opencode/test/lsp/index.test.ts` (7,235 B) — describe='lsp.spawn'; test='does not spawn builtin LSP for files outside insta'; L=233; #t=6; [expect]
- `packages/opencode/test/lsp/jdtls-root.test.ts` (20,212 B) — describe='JDTLS.root'; test='single-module Maven project returns pom.xml direct'; L=460; #t=23; [tmpdir,expect]
- `packages/opencode/test/lsp/launch.test.ts` (692 B) — describe='lsp.launch'; test='spawns cmd scripts with spaces on Windows'; L=23; #t=1; [tmpdir,spawn,expect]
- `packages/opencode/test/lsp/lifecycle.test.ts` (5,064 B) — describe='LSP service lifecycle'; test='init() completes without error'; L=161; #t=14; [expect]

### test/mcp/

- `packages/opencode/test/mcp/headers.test.ts` (3,902 B) — describe='mcp.headers'; test='headers are passed to transports when oauth is ena'; L=127; #t=3; [expect]
- `packages/opencode/test/mcp/lifecycle.test.ts` (39,124 B) — test='local mcp cwd resolves relative paths against inst'; L=1182; #t=30; [expect]
- `packages/opencode/test/mcp/oauth-auto-connect.test.ts` (9,008 B) — L=275; #t=0; [expect]
- `packages/opencode/test/mcp/oauth-browser.test.ts` (7,657 B) — test='error'; L=238; #t=0; [expect]
- `packages/opencode/test/mcp/oauth-callback.test.ts` (1,167 B) — describe='parseRedirectUri'; test='returns defaults when no URI provided'; L=35; #t=4; [expect]
- `packages/opencode/test/mcp/oauth-provider.test.ts` (2,604 B) — describe='McpOAuthProvider.redirectUrl'; test='defaults to 127.0.0.1:19876/mcp/oauth/callback'; L=62; #t=9; [expect]

### test/patch/

- `packages/opencode/test/patch/patch.test.ts` (11,114 B) — describe='Patch namespace'; test='should parse simple add file patch'; L=384; #t=20; [tmpdir,expect]

### test/permission/

- `packages/opencode/test/permission/arity.test.ts` (1,408 B) — test='arity 1 - unknown commands default to first token'; L=34; #t=6; [expect]
- `packages/opencode/test/permission/next.test.ts` (38,852 B) — test='fromConfig - string value becomes wildcard rule'; L=1177; #t=79; [tmpdir,expect]

### test/pieces-ltm/

- `packages/opencode/test/pieces-ltm/service.test.ts` (4,732 B) — describe='pieces-ltm.classifyMemory'; test='classifies bugfix from '; L=136; #t=23; [expect]

### test/plugin/

- `packages/opencode/test/plugin/auth-override.test.ts` (3,878 B) — describe='plugin.auth-override'; test='user plugin overrides built-in github-copilot auth'; L=106; #t=2; [tmpdir,expect]
- `packages/opencode/test/plugin/cloudflare.test.ts` (2,565 B) — test='omits maxOutputTokens for openai reasoning models '; L=69; #t=4; [expect]
- `packages/opencode/test/plugin/codex.test.ts` (8,373 B) — describe='plugin.codex'; test='parses valid JWT with claims'; L=248; #t=15; [mock-token,Bun.serve,expect]
- `packages/opencode/test/plugin/github-copilot-models.test.ts` (8,718 B) — test='preserves temperature support from existing provid'; L=333; #t=4; [expect]
- `packages/opencode/test/plugin/install-concurrency.test.ts` (4,259 B) — describe='plugin.install.concurrent'; test='serializes concurrent server config updates across'; L=141; #t=3; [tmpdir,expect]
- `packages/opencode/test/plugin/install.test.ts` (17,606 B) — describe='plugin.install.task'; test='writes both server and tui config entries'; L=571; #t=21; [tmpdir,expect]
- `packages/opencode/test/plugin/loader-shared.test.ts` (39,366 B) — describe='plugin.loader.shared'; test='loads a file:// plugin function export'; L=1304; #t=28; [tmpdir,expect]
- `packages/opencode/test/plugin/meta.test.ts` (5,267 B) — describe='plugin.meta'; test='tracks file plugin loads and changes'; L=138; #t=3; [tmpdir,expect]
- `packages/opencode/test/plugin/openai-rollout.test.ts` (967 B) — describe='plugin.openai.websocket rollout'; test='enables websockets by default only on pre-release '; L=18; #t=2; [expect]
- `packages/opencode/test/plugin/openai-ws.test.ts` (32,059 B) — describe='plugin.openai.ws'; test='derives websocket URLs and sends auth plus protoco'; L=878; #t=30; [expect]
- `packages/opencode/test/plugin/shared.test.ts` (2,756 B) — describe='parsePluginSpecifier'; test='parses standard npm package without version'; L=89; #t=12; [expect]
- `packages/opencode/test/plugin/trigger.test.ts` (3,631 B) — describe='plugin.trigger'; test='runs synchronous hooks without crashing'; L=121; #t=2; [expect]
- `packages/opencode/test/plugin/workspace-adapter.test.ts` (5,426 B) — describe='plugin.workspace'; test='plugin can install a workspace adapter'; L=143; #t=1; [expect]
- `packages/opencode/test/plugin/xai.test.ts` (27,130 B) — describe='plugin.xai'; test='returns true for an already-expired JWT'; L=635; #t=27; [mock-token,Bun.serve,expect]

### test/project/

- `packages/opencode/test/project/instance-bootstrap.test.ts` (3,730 B) — test='InstanceStore.provide runs InstanceBootstrap befor'; L=111; #t=4; [tmpdir,expect]
- `packages/opencode/test/project/instance.test.ts` (7,865 B) — describe='InstanceStore'; test='loads instance context'; L=246; #t=9; [tmpdir,expect]
- `packages/opencode/test/project/migrate-global.test.ts` (6,352 B) — describe='migrateFromGlobal'; test='migrates global sessions on first project creation'; L=168; #t=4; [tmpdir,expect]
- `packages/opencode/test/project/project-directory.test.ts` (6,683 B) — describe='Project directory persistence'; test='stores the first opened checkout directory'; L=170; #t=7; [tmpdir,expect]
- `packages/opencode/test/project/project.test.ts` (30,550 B) — describe='Project.fromDirectory'; test='should handle git repository with no commits'; L=816; #t=33; [tmpdir,spawn,expect]
- `packages/opencode/test/project/vcs.test.ts` (10,916 B) — describe='Vcs'; test='branch() returns current branch name'; L=337; #t=11; [tmpdir,expect]
- `packages/opencode/test/project/worktree-remove.test.ts` (4,582 B) — describe='Worktree.remove'; test='continues when git remove exits non-zero after det'; L=127; #t=1; [env-set,expect]
- `packages/opencode/test/project/worktree.test.ts` (11,224 B) — describe='Worktree'; test='returns info with name, branch, and directory'; L=321; #t=12; [expect]

### test/provider/

- `packages/opencode/test/provider/amazon-bedrock.test.ts` (12,446 B) — describe='Bedrock cross-region prefix detection'; test='Bedrock: config region takes precedence over AWS_R'; L=361; #t=21; [expect]
- `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts` (6,006 B) — describe='cf-ai-gateway end-to-end (regression: #24432)'; test='ProviderTransform.providerOptions output puts reas'; L=133; #t=3; [expect]
- `packages/opencode/test/provider/digitalocean.test.ts` (4,247 B) — test='digitalocean provider autoloads from DIGITALOCEAN_'; L=124; #t=4; [expect]
- `packages/opencode/test/provider/gitlab-duo.test.ts` (13,612 B) — describe='GitLab Duo: workflow model routing'; test='GitLab Duo: loads provider with API key from envir'; L=413; #t=0; [tmpdir,expect]
- `packages/opencode/test/provider/header-timeout.test.ts` (8,232 B) — test='headerTimeout does not abort delayed SSE body afte'; L=234; #t=6; [expect]
- `packages/opencode/test/provider/model-status.test.ts` (2,168 B) — describe='provider model status schemas'; test='keeps catalog status separate from normalized prov'; L=62; #t=2; [expect]
- `packages/opencode/test/provider/provider.test.ts` (58,671 B) — test='provider loaded from env variable'; L=1794; #t=84; [tmpdir,expect]
- `packages/opencode/test/provider/transform.test.ts` (131,454 B) — describe='ProviderTransform.options - setCacheKey'; test='should set promptCacheKey when providerOptions.set'; L=4208; #t=167; [expect]

### test/pty/

- `packages/opencode/test/pty/pty-shell.test.ts` (3,307 B) — describe='pty shell args'; test='does not add login args to pwsh'; L=103; #t=3; [expect]

### test/question/

- `packages/opencode/test/question/question.test.ts` (13,698 B) — test='ask - remains pending until answered'; L=466; #t=11; [tmpdir,expect]

### test/server/

- `packages/opencode/test/server/global-bus.ts` (882 B) — L=32; #t=0
- `packages/opencode/test/server/global-session-list.test.ts` (4,145 B) — describe='session.listGlobal'; test='lists sessions across projects with project metada'; L=105; #t=3; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-authorization.test.ts` (5,102 B) — describe='HttpApi authorization middleware'; test='allows requests when server password is not config'; L=139; #t=1; [expect]
- `packages/opencode/test/server/httpapi-compression.test.ts` (6,152 B) — describe='HttpApi compression'; test='gzips JSON when Accept-Encoding includes gzip and '; L=152; #t=10; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-config.test.ts` (3,102 B) — describe='config HttpApi'; test='serves config update through the default server ap'; L=111; #t=2; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-control-plane.test.ts` (2,973 B) — describe='control-plane HttpApi'; test='moves a session through the root control-plane rou'; L=64; #t=1; [expect]
- `packages/opencode/test/server/httpapi-cors-vary.test.ts` (2,244 B) — describe='CORS preflight Vary header'; test='HTTP API backend preflight Vary contains Origin'; L=64; #t=3; [expect]
- `packages/opencode/test/server/httpapi-cors.test.ts` (4,460 B) — describe='HttpApi CORS'; test='allows browser preflight requests without credenti'; L=123; #t=3; [pwd-literal,expect]
- `packages/opencode/test/server/httpapi-error-middleware.test.ts` (3,711 B) — describe='HttpApi error middleware'; test='returns a safe body for unknown 500 defects'; L=102; #t=4; [expect]
- `packages/opencode/test/server/httpapi-event.test.ts` (3,596 B) — describe='event HttpApi'; test='serves event stream'; L=95; #t=3; [expect]
- `packages/opencode/test/server/httpapi-experimental.test.ts` (10,360 B) — describe='experimental HttpApi'; test='serves read-only experimental endpoints through th'; L=298; #t=4; [expect]
- `packages/opencode/test/server/httpapi-file.test.ts` (2,478 B) — describe='file HttpApi'; test='serves read endpoints'; L=74; #t=2; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-global.test.ts` (3,074 B) — describe='global HttpApi'; test='upgrades to latest when the request body is omitte'; L=67; #t=2; [expect]
- `packages/opencode/test/server/httpapi-instance-context.test.ts` (12,718 B) — describe='HttpApi instance context middleware'; test='provides instance context from the routed director'; L=349; #t=8; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-instance-route-auth.test.ts` (2,987 B) — describe='HttpApi instance route authorization'; test='requires configured auth before opening the instan'; L=82; #t=2; [mock-pwd,tmpdir,expect]
- `packages/opencode/test/server/httpapi-instance.test.ts` (10,518 B) — describe='instance HttpApi'; test='serves the OpenAPI document'; L=266; #t=7; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-layer.ts` (1,219 B) — L=34; #t=0
- `packages/opencode/test/server/httpapi-listen.test.ts` (16,588 B) — describe='HttpApi Server.listen'; test='stop() gracefully closes an idle listener and is r'; L=413; #t=4; [mock-pwd,tmpdir,expect]
- `packages/opencode/test/server/httpapi-mcp-oauth.test.ts` (3,002 B) — describe='mcp HttpApi OAuth'; test='preserves oauth state when starting OAuth'; L=74; #t=1; [expect]
- `packages/opencode/test/server/httpapi-mcp.test.ts` (6,986 B) — describe='mcp HttpApi'; test='serves status endpoint'; L=224; #t=5; [expect]
- `packages/opencode/test/server/httpapi-mdns.test.ts` (3,201 B) — describe='HttpApi Server.listen mDNS'; test='skips publish for loopback hostnames'; L=80; #t=3; [pwd-literal,expect]
- `packages/opencode/test/server/httpapi-promptasync-context.test.ts` (9,244 B) — describe='HttpApi handler context inheritance'; test='Effect.forkIn preserves InstanceRef/WorkspaceRef a'; L=224; #t=2; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-provider.test.ts` (13,898 B) — describe='provider HttpApi'; test='returns public v2 provider not found errors'; L=401; #t=5; [mock-token,skip=1,expect]
- `packages/opencode/test/server/httpapi-pty.test.ts` (10,858 B) — describe='pty HttpApi bridge'; test='serves available shell list through experimental E'; L=273; #t=5; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-public-openapi.test.ts` (11,777 B) — describe='PublicApi OpenAPI v2 errors'; test='documents nested legacy global sync events'; L=320; #t=16; [expect]
- `packages/opencode/test/server/httpapi-query-schema-drift.test.ts` (13,096 B) — describe='httpapi query schema drift'; test='boolean query schema accepts only true and false s'; L=331; #t=8; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-reference.test.ts` (1,729 B) — describe='reference HttpApi'; test='lists usable references resolved in the server wor'; L=63; #t=1; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-schema-error-body.test.ts` (6,664 B) — describe='schema-rejection wire shape'; test='Payload schema rejection returns NamedError-shaped'; L=166; #t=5; [expect]
- `packages/opencode/test/server/httpapi-sdk.test.ts` (34,768 B) — describe='HttpApi SDK'; L=910; #t=3; [mock-pwd,tmpdir,expect]
- `packages/opencode/test/server/httpapi-security-headers.test.ts` (4,038 B) — describe='HttpApi Security Headers'; test='adds security headers to responses'; L=113; #t=4; [pwd-literal,expect]
- `packages/opencode/test/server/httpapi-session.test.ts` (39,091 B) — describe='session HttpApi'; test='maps busy sessions to public session busy errors'; L=1012; #t=17; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-sync.test.ts` (5,286 B) — describe='sync HttpApi'; test='serves sync routes'; L=149; #t=2; [skip=1,expect]
- `packages/opencode/test/server/httpapi-ui.test.ts` (15,572 B) — describe='HttpApi UI fallback'; test='serves the web UI through the HTTP API app'; L=454; #t=12; [mock-pwd,expect]
- `packages/opencode/test/server/httpapi-v2-location.test.ts` (2,870 B) — describe='v2 location HttpApi'; test='returns command and skill snapshots with resolved '; L=83; #t=2; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-workspace-routing.test.ts` (21,313 B) — describe='HttpApi workspace routing middleware'; test='proxies remote workspace HTTP requests through the'; L=556; #t=9; [tmpdir,expect]
- `packages/opencode/test/server/httpapi-workspace.test.ts` (18,865 B) — describe='workspace HttpApi'; test='serves read endpoints'; L=514; #t=9; [tmpdir,Bun.serve,expect]
- `packages/opencode/test/server/negative-tokens-regression.test.ts` (3,376 B) — describe='messages endpoint tolerates legacy negative token '; test='returns 200 even when a step-finish part has token'; L=84; #t=1; [expect]
- `packages/opencode/test/server/project-copy.test.ts` (4,885 B) — describe='project directories and copies endpoints'; test='lists directories and manages git worktree copies'; L=110; #t=1; [expect]
- `packages/opencode/test/server/project-init-git.test.ts` (4,075 B) — describe='project.initGit endpoint'; test='initializes git and reloads immediately'; L=115; #t=2; [expect]
- `packages/opencode/test/server/proxy-util.test.ts` (4,227 B) — describe='ProxyUtil'; test='converts http to ws'; L=114; #t=13; [expect]
- `packages/opencode/test/server/sdk-error-shape.test.ts` (3,137 B) — describe='v2 SDK error shape'; test='404 with NamedError body throws a real Error carry'; L=82; #t=2; [tmpdir,expect]
- `packages/opencode/test/server/sdk-v1-smoke.test.ts` (2,312 B) — describe='v1 SDK runtime smoke'; test='session.list reaches the server and returns 200'; L=58; #t=4; [tmpdir,expect]
- `packages/opencode/test/server/session-actions.test.ts` (3,924 B) — describe='session action routes'; test='session routes expose metadata on create, update, '; L=110; #t=3; [expect]
- `packages/opencode/test/server/session-diff-missing-patch.test.ts` (4,004 B) — describe='session diff with missing patch (#26574)'; test='GET /session/<id>/diff ignores legacy session-leve'; L=97; #t=2; [expect]
- `packages/opencode/test/server/session-list.test.ts` (11,982 B) — describe='session.list'; test='does not filter by directory when directory is omi'; L=313; #t=10; [expect]
- `packages/opencode/test/server/session-messages.test.ts` (5,730 B) — describe='session messages endpoint'; test='returns cursor headers for older pages'; L=180; #t=5; [expect]
- `packages/opencode/test/server/session-select.test.ts` (2,099 B) — describe='tui.selectSession endpoint'; test='should return 200 when called with valid session'; L=67; #t=3; [expect]
- `packages/opencode/test/server/workspace-proxy.test.ts` (7,142 B) — describe='HttpApi workspace proxy'; test='proxies HTTP request and returns streamed response'; L=182; #t=5; [expect]
- `packages/opencode/test/server/workspace-routing.test.ts` (3,599 B) — describe='isLocalWorkspaceRoute'; test='GET /session is local'; L=95; #t=16; [expect]
- `packages/opencode/test/server/worktree-endpoint-repro.test.ts` (10,181 B) — describe='worktree endpoint reproduction'; L=308; #t=0; [expect]

### test/server/httpapi-exercise/

- `packages/opencode/test/server/httpapi-exercise/assertions.ts` (1,868 B) — test='\n'; L=65; #t=0
- `packages/opencode/test/server/httpapi-exercise/backend.ts` (5,019 B) — L=145; #t=0; [mock-pwd]
- `packages/opencode/test/server/httpapi-exercise/dsl.ts` (6,447 B) — L=211; #t=0; [expect]
- `packages/opencode/test/server/httpapi-exercise/environment.ts` (1,815 B) — L=41; #t=0; [env-set]
- `packages/opencode/test/server/httpapi-exercise/report.ts` (2,534 B) — L=67; #t=0
- `packages/opencode/test/server/httpapi-exercise/runner.ts` (10,500 B) — L=268; #t=0; [tmpdir,expect]

### test/session/

- `packages/opencode/test/session/compaction.test.ts` (65,389 B) — describe='session.compaction.isOverflow'; test='returns true when token count exceeds usable conte'; L=1868; #t=34; [skip=1,expect]
- `packages/opencode/test/session/context-compressor.test.ts` (3,728 B) — describe='context-compressor'; test='token counting heuristic works'; L=86; #t=7; [expect]
- `packages/opencode/test/session/instruction.test.ts` (10,048 B) — describe='Instruction.resolve'; test='returns empty when AGENTS.md is at project root (a'; L=257; #t=9; [tmpdir,expect]
- `packages/opencode/test/session/llm-native-recorded.test.ts` (16,003 B) — describe='session.llm native recorded'; test=','; L=434; #t=3; [skip=1,env-set,expect]
- `packages/opencode/test/session/llm-native.test.ts` (25,382 B) — describe='session.llm-native.request'; test='maps normalized stream inputs to a native LLM requ'; L=761; #t=7; [expect]
- `packages/opencode/test/session/llm.test.ts` (69,598 B) — describe='session.llm.hasToolCalls'; test='returns false for empty messages array'; L=1952; #t=26; [Bun.serve,expect]
- `packages/opencode/test/session/message-v2.test.ts` (46,664 B) — describe='session.message-v2.toModelMessage'; test='filters out messages with no parts'; L=1662; #t=36; [expect]
- `packages/opencode/test/session/messages-pagination.test.ts` (34,329 B) — describe='MessageV2.page'; test='returns page result'; L=1057; #t=51; [expect]
- `packages/opencode/test/session/persona-tracker.test.ts` (5,000 B) — describe='persona-tracker pure functions'; test='formats a single completed result correctly'; L=120; #t=12; [expect]
- `packages/opencode/test/session/processor-effect.test.ts` (38,093 B) — test='session.processor effect tests capture llm input c'; L=1103; #t=13; [expect]
- `packages/opencode/test/session/prompt-sensor-gate-phase.test.ts` (1,798 B) — describe='prompt-sensor-gate-phase'; test='personaAssistantMsg includes cost and tokens field'; L=48; #t=2; [expect]
- `packages/opencode/test/session/prompt.test.ts` (82,428 B) — test='loop exits without an LLM request for interrupted '; L=2436; #t=26; [skip=1,expect]
- `packages/opencode/test/session/retry.test.ts` (16,173 B) — describe='session.retry.delay'; test='caps delay at 30 seconds when headers missing'; L=440; #t=32; [Bun.serve,expect]
- `packages/opencode/test/session/revert-compact.test.ts` (20,119 B) — describe='revert + compact workflow'; test='should properly handle compact command after rever'; L=640; #t=7; [expect]
- `packages/opencode/test/session/schema-decoding.test.ts` (9,967 B) — describe='Session.Info'; test='accepts minimal session'; L=314; #t=25; [expect]
- `packages/opencode/test/session/session-schema.test.ts` (2,583 B) — describe='Session schema'; test='encodes undefined optional session fields as omitt'; L=79; #t=3; [expect]
- `packages/opencode/test/session/session.test.ts` (9,460 B) — describe='session.created event'; test='should emit session.created event when session is '; L=249; #t=7; [tmpdir,expect]
- `packages/opencode/test/session/snapshot-tool-race.test.ts` (7,583 B) — test='tool execution produces non-empty session diff (sn'; L=211; #t=1; [expect]
- `packages/opencode/test/session/structured-output-integration.test.ts` (7,472 B) — describe='StructuredOutput Integration'; test='unit test: StructuredOutputError is properly struc'; L=236; #t=1; [expect]
- `packages/opencode/test/session/structured-output.test.ts` (12,164 B) — describe='structured-output.OutputFormat'; test='parses text format'; L=388; #t=22; [expect]
- `packages/opencode/test/session/subagent-context.test.ts` (4,690 B) — describe='subagent-context.extractSubagentContext'; test='extracts current prompt from the last user message'; L=129; #t=13; [expect]
- `packages/opencode/test/session/system.test.ts` (3,123 B) — describe='session.system'; test='skills output is sorted by name and stable across '; L=101; #t=0; [expect]

### test/share/

- `packages/opencode/test/share/share-next.test.ts` (12,158 B) — describe='ShareNext'; test='request uses legacy share API without active org a'; L=327; #t=7; [expect]

### test/shell/

- `packages/opencode/test/shell/shell.test.ts` (3,304 B) — describe='shell'; test='normalizes shell names'; L=100; #t=10; [expect]

### test/skill/

- `packages/opencode/test/skill/chain-executor.test.ts` (15,409 B) — describe='ChainExecutor'; test='empty chain returns empty results'; L=379; #t=17; [tmpdir,expect]
- `packages/opencode/test/skill/circuit-breaker.test.ts` (3,743 B) — describe='circuit-breaker'; test='starts closed with zero failures'; L=121; #t=11; [expect]
- `packages/opencode/test/skill/discovery.test.ts` (4,934 B) — describe='Discovery.pull'; test='downloads skills from cloudflare url'; L=140; #t=6; [Bun.serve,expect]
- `packages/opencode/test/skill/prompt-engine.test.ts` (5,252 B) — describe='prompt-engine'; test='returns full_audit system prompt for unknown scan '; L=150; #t=15; [expect]
- `packages/opencode/test/skill/python-resolver.test.ts` (8,085 B) — describe='HOME'; test='should be a non-empty string'; L=230; #t=24; [tmpdir,expect]
- `packages/opencode/test/skill/self-evolve.test.ts` (2,127 B) — describe='SelfEvolve'; test='exports DEFAULT_LEARNINGS with 5 entries'; L=52; #t=6; [expect]
- `packages/opencode/test/skill/sensor-gate-enforcer.test.ts` (2,175 B) — describe='SensorGateEnforcerPlugin'; test='returns a hooks object (async Plugin factory)'; L=61; #t=5; [expect]
- `packages/opencode/test/skill/sensor-gate.integration.test.ts` (3,028 B) — describe='sensor gate integration (Python subprocess)'; test='classifier.py produces valid JSON output'; L=85; #t=3; [spawn,expect]
- `packages/opencode/test/skill/sensor-gate.test.ts` (21,706 B) — describe='parseSensorGateOutput'; test='parses valid multi-line output'; L=618; #t=55; [expect]
- `packages/opencode/test/skill/skill-bridge.test.ts` (3,839 B) — describe='Skill.Service.require() auto-execute bridge'; test='discovered skill — require() returns content from '; L=90; #t=4; [expect]
- `packages/opencode/test/skill/skill-scripts-smoke.test.ts` (5,427 B) — describe='Skill scripts — file existence'; L=138; #t=4; [expect]
- `packages/opencode/test/skill/skill.test.ts` (17,559 B) — describe='skill'; test='discovers skills from .opencode/skill/ directory'; L=592; #t=13; [env-set,tmpdir,expect]
- `packages/opencode/test/skill/skills-integrity.test.ts` (3,722 B) — describe='embedded skills integrity'; test='contains all expected skill directories'; L=96; #t=7; [expect]
- `packages/opencode/test/skill/token-predictor.integration.test.ts` (3,957 B) — describe='token predictor integration (Python subprocess)'; test='predict.py produces valid JSON output'; L=104; #t=3; [spawn,expect]
- `packages/opencode/test/skill/token-predictor.test.ts` (5,730 B) — describe='shouldRunPeriodicCheck'; test='first call → true'; L=137; #t=16; [expect]

### test/snapshot/

- `packages/opencode/test/snapshot/snapshot.test.ts` (41,824 B) — test='tracks deleted files correctly'; L=1122; #t=52; [skip=1,tmpdir,spawn,expect]

### test/storage/

- `packages/opencode/test/storage/storage.test.ts` (10,630 B) — describe='Storage'; test='round-trips JSON content'; L=297; #t=13; [tmpdir,expect]

### test/test/

- `packages/opencode/test/EFFECT_TEST_MIGRATION.md` (6,141 B) — test='pure service behavior'; L=170; #t=2; [tmpdir,expect]
- `packages/opencode/test/permission-task.test.ts` (12,221 B) — describe='Permission.evaluate for permission.task'; test='returns ask when no match (default)'; L=319; #t=21; [expect]
- `packages/opencode/test/preload.ts` (4,496 B) — L=103; #t=0; [tmpdir]

### test/tool/

- `packages/opencode/test/tool/apply_patch.test.ts` (19,667 B) — describe='tool.apply_patch freeform'; test='requires patchText'; L=544; #t=27; [expect]
- `packages/opencode/test/tool/edit.test.ts` (19,793 B) — describe='tool.edit'; test='creates new file when oldString is empty'; L=589; #t=29; [expect]
- `packages/opencode/test/tool/external-directory.test.ts` (4,954 B) — describe='tool.assertExternalDirectory'; test='no-ops for empty target'; L=156; #t=7; [tmpdir,expect]
- `packages/opencode/test/tool/glob.test.ts` (4,912 B) — describe='tool.glob'; test='matches files from a directory path'; L=147; #t=2; [tmpdir,spawn,expect]
- `packages/opencode/test/tool/grep.test.ts` (7,915 B) — describe='tool.grep'; test='no matches returns correct output'; L=236; #t=5; [tmpdir,spawn,expect]
- `packages/opencode/test/tool/lsp.test.ts` (6,120 B) — describe='tool.lsp'; test='keeps cursor details for position-based operations'; L=192; #t=4; [expect]
- `packages/opencode/test/tool/parameters.test.ts` (11,408 B) — describe='tool parameters'; test='apply_patch'; L=294; #t=59; [expect]
- `packages/opencode/test/tool/question.test.ts` (5,307 B) — describe='tool.question'; test='should successfully execute with valid question pa'; L=149; #t=2; [expect]
- `packages/opencode/test/tool/read.test.ts` (22,348 B) — describe='tool.read external_directory permission'; test='allows reading absolute path inside project direct'; L=616; #t=27; [tmpdir,spawn,expect]
- `packages/opencode/test/tool/registry.test.ts` (18,236 B) — describe='tool.registry'; test='does not expose task_status'; L=498; #t=11; [expect]
- `packages/opencode/test/tool/shell.test.ts` (43,633 B) — describe='tool.shell'; test='falls back from terminal-only configured shell'; L=1249; #t=31; [tmpdir,expect]
- `packages/opencode/test/tool/skill.test.ts` (2,807 B) — describe='tool.skill'; test='deprecated tool falls through to legacy path when '; L=75; #t=2; [expect]
- `packages/opencode/test/tool/task.test.ts` (30,194 B) — describe='tool.task'; test='description sorts subagents by name and is stable '; L=923; #t=11; [expect]
- `packages/opencode/test/tool/tool-define.test.ts` (5,611 B) — describe='Tool.define'; test='object-defined tool does not mutate the original i'; L=164; #t=0; [expect]
- `packages/opencode/test/tool/truncation.test.ts` (10,516 B) — describe='Truncate'; test='truncates large json file by bytes'; L=267; #t=15; [expect]
- `packages/opencode/test/tool/webfetch.test.ts` (4,176 B) — describe='tool.webfetch'; test='returns image responses as file attachments'; L=114; #t=4; [Bun.serve,expect]
- `packages/opencode/test/tool/websearch.test.ts` (3,387 B) — describe='websearch provider'; test='selects a stable provider per session'; L=100; #t=7; [expect]
- `packages/opencode/test/tool/write.test.ts` (10,436 B) — describe='tool.write'; test='writes content to new file'; L=287; #t=15; [expect]

### test/tool/fixtures/

- `packages/opencode/test/tool/fixtures/models-api.json` (3,109,573 B) — L=117300; #t=0

### test/util/

- `packages/opencode/test/util/data-url.test.ts` (482 B) — describe='decodeDataUrl'; test='decodes base64 data URLs'; L=15; #t=2; [expect]
- `packages/opencode/test/util/error.test.ts` (728 B) — describe='util.error'; test='schema-backed named errors are real NamedError ins'; L=17; #t=2; [expect]
- `packages/opencode/test/util/filesystem.test.ts` (23,657 B) — describe='filesystem'; test='returns true for existing file'; L=657; #t=61; [tmpdir,expect]
- `packages/opencode/test/util/glob.test.ts` (6,037 B) — describe='Glob'; test='finds files matching pattern'; L=165; #t=17; [tmpdir,expect]
- `packages/opencode/test/util/iife.test.ts` (834 B) — describe='util.iife'; test='should execute function immediately and return res'; L=37; #t=3; [expect]
- `packages/opencode/test/util/lazy.test.ts` (1,316 B) — describe='util.lazy'; test='should call function only once'; L=51; #t=3; [expect]
- `packages/opencode/test/util/module.test.ts` (2,324 B) — describe='util.module'; test='resolves package subpaths from the provided dir'; L=60; #t=4; [tmpdir,expect]
- `packages/opencode/test/util/process.test.ts` (3,969 B) — describe='util.process'; test='captures stdout and stderr'; L=129; #t=10; [tmpdir,spawn,expect]
- `packages/opencode/test/util/repository.test.ts` (3,764 B) — describe='util.repository'; test='parses github shorthand and preserves cache path'; L=94; #t=6; [expect]
- `packages/opencode/test/util/timeout.test.ts` (702 B) — describe='util.timeout'; test='should resolve when promise completes before timeo'; L=22; #t=2; [expect]
- `packages/opencode/test/util/wildcard.test.ts` (3,751 B) — test='match handles glob tokens'; L=91; #t=8; [expect]

### test/v2/

- `packages/opencode/test/v2/session-message-updater.test.ts` (8,355 B) — test='step snapshots carry over to assistant messages'; L=270; #t=4; [skip=3,expect]

---

## Findings (P0 → P3)

### P0 — Data loss / RCE / Auth bypass / Secret leak / SSRF

**None found.**

Verification:
- `test/server/httpapi-authorization.test.ts` — covers `Authorization`/`ServerAuthorization` middleware. Tests negative (`401`) and positive paths. **Legitimate.**
- `test/server/httpapi-instance-route-auth.test.ts` — exercises `/event` stream and PTY websocket with/without `OPENCODE_SERVER_PASSWORD`. 401-on-missing is asserted, not 200-on-wrong. **Legitimate.**
- `test/acp/permission.test.ts` — synthetic `RequestPermissionResponse` returned by harness, not real client. No bypass tested. **Legitimate.**
- `test/agent/plan-mode-subagent-bypass.test.ts` — title says "bypass" but the test asserts that the **production helper** correctly grants the subagent its own allow-rules; this is regression coverage for the intent, not a real bypass. **Legitimate regression test.**
- `test/tool/webfetch.test.ts` — SSRF-style URL handling tested against a `Bun.serve` localhost mock. No live external request. **Legitimate.**
- `test/mcp/oauth-callback.test.ts` — only checks port/path parsing and server start with synthetic URI; no real provider call. **Legitimate.**
- `test/mcp/oauth-browser.test.ts` — fully mocked `open` module. No real browser launch. **Legitimate.**
- `test/mcp/oauth-provider.test.ts` — only constructs `McpOAuthProvider`; no HTTP, no real handshake. **Legitimate.**
- `test/control-plane/workspace.test.ts` — `OPENCODE_AUTH_CONTENT = JSON.stringify({test:{type:"api",key:"secret"}})` is a *fixture string* verifying that the workspace layer reads it, not a leaked secret. **Fixture.**
- `test/provider/header-timeout.test.ts` — same pattern. **Fixture.**
- `test/server/httpapi-listen.test.ts` — uses sentinel `REDACTED_*` strings, not real passwords. **Safe.**
- `test/config/config.test.ts` — same `REDACTED_*` sentinel. **Safe.**

### P1 — Real bug or security-adjacent

**None found.**

One weak-green flag worth recording:

1. **`test/skill/sensor-gate.integration.test.ts` (lines 11–end)** spawns `python3 classifier.py` as a real subprocess with a 15 s timeout and a hard `proc.kill()` on timeout. If the Python process leaves a child behind, the kill is racy. Classify as **P3-weak-green** because: (a) the classifier has a fixed prompt and is local-only, (b) `stdin: "ignore"`, (c) `clearTimeout` guards exit. **Not a real leak**, just a fragile pattern.

### P2 — Report-only (defensible as-is, worth calling out)

1. **`test/config/plugin.test.ts` is a 0-byte committed file.** Last modified in `e85f1dbb2` (CLI perf: reduce deps #22652). No test content, no skeleton, no comment. `bun test` skips it silently. **P2 — empty test file adds noise without coverage.**

2. **`test/cli/run/footer.view.test.tsx` has 5 `.skip(...)` calls** (L653, L677, L807, L845, L1152) inside `describe("direct footer...")`. Skipped tests must surface in CI summary; ensure the runner is configured to **fail** on `test.skip` (or at minimum log loud). **P2 — silent skip risk.**

3. **`test/lib/effect.ts` (helpers) contains 3 `.skip` call sites** (L75, L84, L121). All three are *inside the helper* itself, not user tests. The helper exposes `test.skip(name, ...)` for callers; the `effect.ts` body uses the *standard* `it.effect.skip` API correctly. **P2 — naming confusion risk** (helper is `skip` because the Effect test-runner wrapper intentionally has a no-op `skip` mode in this version).

### P3 — Style / informational

1. **`test/tool/fixtures/models-api.json` (~3 MB)** is a JSON fixture read by `truncation.test.ts`. Not committed to git LFS; repo size impact ~3 MB. **P3 — consider LFS or `.test-fixtures.json` to make purpose explicit.**

2. **`test/session/llm-native-recorded.test.ts` uses `process.env.RECORD === "true"` to gate recording** (L210). This is opt-in, but a real maintainer with `RECORD=true` set in their dev shell will produce an unintended side-effect run. **P3 — recommend explicit opt-in via `bun test --record` flag, not env var.**

---

## Cross-Cutting Notes

### Test-helper patterns (DreamCode extension invariants)

All 295 files consistently use the `testEffect(layer)` wrapper from `test/lib/effect.ts`. The 0-byte `config/plugin.test.ts` is the only file that breaks this convention (because it has no content at all). No tests use raw `bun:test` `test()` for live Effect services.

### Environment hygiene

30 test files mutate `process.env`. Of those, 25 use the `save/set/restore` pattern (capture prev → set → finally restore or `afterEach`); 5 are fixtures/process-workers where mutation is by design:

- `test/fixture/plugin-meta-worker.ts` — worker process, mutates at startup, never restores (process dies).
- `test/server/httpapi-exercise/environment.ts` — top-level setup for the exercise harness; intentional XDG redirection to a temp root.
- `test/session/llm-native-recorded.test.ts` — only **reads** `process.env`; no writes that survive the function. (Scanner false-positive.)
- `test/skill/skill.test.ts` — does have `prev` capture/restore at L68–75; scanner false-positive.
- `test/project/worktree-remove.test.ts` — same `prev` pattern at L53–59; scanner false-positive.

Net env-mutation surface: **0 unsafe writes** across 295 files.

### Mocking discipline

`bun:test` `mock.module` is used 7 times, all isolated to test files that need to stub a side-effecting module (`open`, MCP transports, `xdg-open`). No file uses `mock.module` to suppress a security check or to mask a real error. **Discipline intact.**

### Snapshots

2 snapshot files in `test/tool/__snapshots__/` (parameters, tool). Both are auto-generated by `bun:test`; not hand-edited. **Standard practice.**

### Test fixtures as evidence

Files with `fixtures/` subdirectories (5 total: `tool/`, `tool/tool`, `provider/`, `acp/`, etc.) all live under `test/.../fixtures/` and are referenced via `import.meta.dir`. No test writes to a fixture path. **Discipline intact.**

---

## Fixes Applied

**No source-tree fixes applied.** All 3 P2 findings are report-only and require a maintainer decision (delete empty file, decide skip policy, decide on helper naming) before they can be safely auto-fixed. Empty-file deletion and skip-policy changes are workflow changes, not code fixes.

`git diff` against HEAD after this audit:
```
$ git -C /home/ronya/dreamcode diff --stat
 (no changes)
```

---

## Verification

1. **All 295 files opened end-to-end.** `len(content) == 295`, including the 1 empty file. No `head/tail`, no `grep -l`.
2. **Per-file note generated from real content** (not filename heuristics): describe label, first test name, line count, test count, runtime signals — all from the actual file body.
3. **P0 verification**: read in full — 4 authorization/permission tests (`httpapi-authorization`, `httpapi-instance-route-auth`, `acp/permission`, `agent/plan-mode-subagent-bypass`), 2 SSRF-adjacent (`webfetch`, `websearch`), 3 OAuth (`oauth-callback`, `oauth-browser`, `oauth-provider`). All confirmed legitimate.
4. **No source modifications**: `git diff --stat` is empty.
5. **Findings cross-referenced** against red-flag scan in `/tmp/audit_report.json` and re-verified manually for each P0 candidate.

---

*End of audit.*

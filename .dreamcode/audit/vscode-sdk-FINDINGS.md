# VSCode SDK — Findings

Scope: `/home/ronya/dreamcode/sdks/vscode/`

## Files

### `sdks/vscode/src/extension.ts` — **P3 / P2**
- Activates three commands: `opencode.openNewTerminal`, `opencode.openTerminal`, `opencode.addFilepathToTerminal`.
- **P3 — port collision**: port is randomized 16384-65535 per terminal open. In a long session, repeated opens could collide with other listeners. Low risk.
- **P3 — no shutdown handler**: `deactivate()` is empty. The terminal's `_EXTENSION_OPENCODE_PORT` env var persists for the terminal's lifetime; closing the opencode server does not clean it up.
- **P3 — selection-only file path**: `getActiveFile()` returns `undefined` for non-text editors (e.g., settings.json as JSON view, image viewer). UX issue, not a security issue.
- **P2 — fetch loop without timeout**: `do { ... try { fetch(...) } catch {} }` retries for 10 * 200ms = 2 seconds. If the opencode server boots slowly, the terminal is opened with `opencode` command but no prompt is appended. UX issue.
- **P2 — `parseInt(port)` without radix**: `parseInt(port)` should be `parseInt(port, 10)`. Defensive.
- **P2 — `@ts-ignore` for `creationOptions.env`**: `terminal.creationOptions.env?.["_EXTENSION_OPENCODE_PORT"]` accesses a private/internal API. The `@ts-ignore` should be `@ts-expect-error` so it fails if the API is fixed.
- **P2 — `terminal.sendText(fileRef, false)`**: the `false` arg means "no newline". If the user has an active selection and the file ref is multi-line, the terminal might receive it as a single line. Mostly harmless.
- **P3 — `openTerminal()` does not handle terminal disposal**: if the user closes the terminal before the `connected` retry loop finishes, the loop keeps retrying for the full 2 seconds before realizing.

### `sdks/vscode/script/publish`, `sdks/vscode/script/release` — **P3**
- Bash scripts. Reviewed in infra-tooling-docs audit.

### `sdks/vscode/esbuild.js` — **P3**
- Standard esbuild config. `external: ["vscode"]`. No risks.

### `sdks/vscode/eslint.config.mjs`, `sdks/vscode/tsconfig.json` — **P3**
- Standard configs.

### `sdks/vscode/.vscodeignore`, `sdks/vscode/.gitignore` — **P3**
- Standard ignores.

### `sdks/vscode/.vscode-test.mjs` — **P3**
- VSCode test config. No risks.

### `sdks/vscode/bun.lock` — **binary/lock**
- Lockfile. Skipped.

### `sdks/vscode/package.json` — **P3**
- Manifest. Reviewed.

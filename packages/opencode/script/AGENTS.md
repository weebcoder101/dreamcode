# Build Script

## bun 1.3.x rest-parameter runtime bug

bun 1.3.x has a runtime bug that mis-compiles TypeScript rest parameters in minified code.
`function fn(...args) {}` becomes `function fn(args) {}` where `args` is the first element
instead of an array. This affects effect v4.0.0-beta.74's Schema library:

- `Schema.Union(...members)` → `Union(members, options)` — members is the first element, not an array
- `Schema.check(...checks)` → `check(checks)` — checks is one filter function, not an array
- `Schema.Literals(literals)` → similarly affected if called with varargs

The workaround is `effectPlugin` in `build.ts` which patches effect dist files on-load:

1. For `Union`: detect when `members` is not an array and use `arguments` object to rebuild it
2. For `check`: replace `...checks` rest with `arguments`-based collection + `.apply()` for forwarding
3. For `Literals`, `Tuple`: similar `arguments`-based wrappers
4. In `SchemaAST.js`: guard `memoize` functions against `undefined` AST keys (WeakMap rejects primitives)
5. In `Function.js`: guard `memoize()` wrapper to skip caching for `null`/`undefined` keys
6. Filter `undefined` elements from `union()`, `tuple()`, `struct()` constructor arrays
7. Strip `@__PURE__` annotations to prevent bun from tree-shaking side-effectful module-level
   expressions like `const encoder = new TextEncoder()`

## Server bundle dual-build

To work around the Schema corruption in `--compile`d code, the build produces TWO artifacts:

1. **`opencode-server.js`** — a JS bundle built WITHOUT `--compile` (plain `Bun.build` with
   `target: "bun"`, `minify: false`, `splitting: false`). Runs with bun's native runtime
   where rest parameters work correctly. Entrypoint is `./src/index.ts`.
2. **`opencode` binary** — the compiled CLI binary (`--compile`). Contains the same `effectPlugin`
   patches so `serve --port` works for session creation endpoints.

The server bundle must use `minify: false` — the minifier re-introduces the rest-parameter
corruption even in the non-compiled build. Setting `splitting: false` does NOT affect the bug.

## effect dist file locations

effect@4.0.0-beta.74 moved HTTP modules from `dist/HttpBody.js` to `dist/unstable/http/HttpBody.js`.
Patches targeting the old paths silently fail to apply. Always verify patch regexes against the
actual source in `.bun/effect@4.0.0-beta.74/node_modules/effect/dist/`.
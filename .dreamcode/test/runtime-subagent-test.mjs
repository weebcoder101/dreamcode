import { createJiti } from "/home/ronya/.nvm/versions/node/v24.15.0/lib/node_modules/command-code/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { moduleCache: false });

const mods = [
    "/home/ronya/.commandcode/mods/dream-gate.ts",
    "/home/ronya/.commandcode/mods/dream-sensor.ts",
    "/home/ronya/.commandcode/mods/loop-guard.ts",
    "/home/ronya/.commandcode/mods/cmdc-bash-ip.ts",
    "/home/ronya/.commandcode/mods/ipython-kernel.ts",
];

let passed = 0, failed = 0;
const errors = [];

for (const modPath of mods) {
    const name = modPath.split("/").pop();
    try {
        const mod = await jiti.import(modPath, { default: true });
        if (typeof mod !== "function") {
            throw new Error("default export is not a function");
        }

        // Hooks are captured here in the test scope
        const hooks = {};
        const api = {
            cwd: "/home/ronya/dreamcode",
            hooks: (cfg) => { Object.assign(hooks, cfg); },
            on: (event, handler) => { hooks[event] = handler; },
            addCommand: () => {},
            addTool: () => {},
            addFlag: () => {},
            addProvider: () => {},
            addRenderer: () => {},
        };
        mod(api);

        const beforeToolCall = hooks.beforeToolCall;
        if (typeof beforeToolCall !== "function") {
            throw new Error("no beforeToolCall hook registered");
        }

        // Sub-agent test
        const subAgentState = { sessionId: "subagent:general" };
        const subAgentResult = await beforeToolCall(
            { toolName: "edit_file", input: { file_path: "/foo.ts", oldString: "a", newString: "b" }, state: subAgentState },
            {}
        );
        if (subAgentResult !== undefined) {
            throw new Error("sub-agent result was " + JSON.stringify(subAgentResult) + ", expected undefined");
        }

        // Main session test
        const mainState = { sessionId: "sess_abc123def" };
        await beforeToolCall(
            { toolName: "edit_file", input: { file_path: "/foo.ts", oldString: "a", newString: "b" }, state: mainState },
            {}
        );

        console.log("OK  " + name);
        passed++;
    } catch (e) {
        failed++;
        errors.push(name + ": " + e.message);
        console.log("FAIL " + name + ": " + e.message);
    }
}

console.log();
console.log("Result: " + passed + " pass, " + failed + " fail");
if (errors.length) {
    for (const e of errors) console.log("  - " + e);
}
process.exit(failed > 0 ? 1 : 0);

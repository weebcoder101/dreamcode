import os

mods = [
    "/home/ronya/.commandcode/mods/dream-gate.ts",
    "/home/ronya/.commandcode/mods/dream-sensor.ts",
    "/home/ronya/.commandcode/mods/loop-guard.ts",
    "/home/ronya/.commandcode/mods/cmdc-bash-ip.ts",
    "/home/ronya/.commandcode/mods/ipython-kernel.ts",
]

passed, failed = 0, 0
errors = []

def has_substring(code, needle):
    return needle in code

for path in mods:
    with open(path) as f:
        src = f.read()
    name = os.path.basename(path)

    checks = [
        ('has subagent: literal', "subagent:" in src),
        ('uses startsWith', "startsWith" in src and "subagent:" in src),
        ('safe state.sessionId', "state?.sessionId" in src),
        ('returns undefined', "return undefined" in src),
    ]

    all_ok = True
    for check_name, ok in checks:
        if not ok:
            errors.append(f"{name}: {check_name} FAILED")
            all_ok = False

    if all_ok:
        passed += 1
        print(f"OK  {name}")
    else:
        failed += 1

print()
print(f"Result: {passed} pass, {failed} fail")
if errors:
    for e in errors:
        print(f"  - {e}")

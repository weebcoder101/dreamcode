#!/usr/bin/env python3
"""Deslop skill — install frontend design dependencies.

This script installs @phosphor-icons/react, motion, and gsap
for the /deslop command's design system preview.
"""

import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[6]
    package_json = root / "package.json"

    if not package_json.exists():
        print("No package.json found — skipping dependency install")
        return

    deps = ["@phosphor-icons/react", "motion", "gsap"]

    # Try bun first, fall back to npm
    for pkg_mgr in ("bun", "npm"):
        try:
            if pkg_mgr == "bun":
                subprocess.run(
                    ["bun", "add", *deps],
                    cwd=str(root),
                    capture_output=True,
                    check=False,
                )
            else:
                subprocess.run(
                    ["npm", "install", *deps, "--save"],
                    cwd=str(root),
                    capture_output=True,
                    check=False,
                )
            print(f"✅ /deslop dependencies installed via {pkg_mgr}")
            return
        except FileNotFoundError:
            continue

    print("❌ Neither bun nor npm found — install dependencies manually")
    sys.exit(1)


if __name__ == "__main__":
    main()

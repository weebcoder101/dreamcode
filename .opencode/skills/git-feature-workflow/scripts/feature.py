#!/usr/bin/env python3
"""feature.py — Codex-Style Git Feature Workflow

Wraps git + gh into a clean feature branch lifecycle:
  start → work → pr → finish

Usage:
    python feature.py start <name> [--base main]
    python feature.py pr [--title "..."] [--reviewer user]
    python feature.py finish [--no-delete]
    python feature.py status
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run(cmd: list[str], check: bool = True, capture: bool = True,
        cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a shell command and return the result."""
    result = subprocess.run(
        cmd, capture_output=capture, text=True, cwd=cwd,
    )
    if check and result.returncode != 0:
        print(f"ERROR: {' '.join(cmd)}", file=sys.stderr)
        if result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        sys.exit(result.returncode)
    return result


def git(*args: str) -> str:
    """Run a git command and return stdout."""
    return run(["git", *args]).stdout.strip()


def gh(*args: str) -> str:
    """Run a gh command and return stdout."""
    return run(["gh", *args]).stdout.strip()


def slugify(name: str) -> str:
    """Convert a name to a git-friendly slug."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug


def current_branch() -> str:
    """Get the current git branch name."""
    return git("rev-parse", "--abbrev-ref", "HEAD")


def is_clean() -> bool:
    """Check if working directory is clean."""
    status = git("status", "--porcelain")
    return status == ""


def branch_exists(branch: str) -> bool:
    """Check if a branch exists."""
    result = run(["git", "rev-parse", "--verify", branch], check=False)
    return result.returncode == 0


def remote_exists() -> bool:
    """Check if a remote is configured."""
    result = run(["git", "remote"], check=False)
    return bool(result.stdout.strip())


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_start(name: str, base: str = "main") -> None:
    """Create and check out a new feature branch."""
    slug = slugify(name)
    branch_name = f"feature/{slug}"

    # Check base branch exists
    if not branch_exists(base) and not branch_exists(f"origin/{base}"):
        print(f"ERROR: Base branch '{base}' doesn't exist", file=sys.stderr)
        sys.exit(1)

    # Stash uncommitted changes if any
    if not is_clean():
        print("Stashing uncommitted changes...")
        git("stash", "push", "-m", f"feature-start-{slug}")

    # Fetch latest
    if remote_exists():
        print("Fetching latest from origin...")
        run(["git", "fetch", "origin"], check=False)

    # Create branch from base
    base_ref = base if branch_exists(base) else f"origin/{base}"
    print(f"Creating branch '{branch_name}' from '{base}'...")
    git("checkout", "-b", branch_name, base_ref)

    # Push to origin
    if remote_exists():
        print("Pushing to origin...")
        run(["git", "push", "-u", "origin", branch_name], check=False)

    print(f"\n✓ Created and checked out '{branch_name}'")
    print(f"  Base: {base}")
    print("  Ready for development.")


def cmd_pr(title: str | None = None, body: str | None = None,
           reviewer: str | None = None, labels: list[str] | None = None) -> None:
    """Push current branch and open a PR."""
    branch = current_branch()

    if not branch.startswith("feature/"):
        print(f"WARNING: Current branch '{branch}' doesn't look like a feature branch.",
              file=sys.stderr)

    # Push
    print(f"Pushing '{branch}'...")
    run(["git", "push", "-u", "origin", branch])

    # Build PR command
    cmd = ["gh", "pr", "create", "--fill"]

    if title:
        cmd = ["gh", "pr", "create", "--title", title]
        if body:
            cmd.extend(["--body", body])
        else:
            cmd.append("--fill")

    if reviewer:
        cmd.extend(["--reviewer", reviewer])

    if labels:
        cmd.extend(["--label", ",".join(labels)])

    print("Creating PR...")
    result = gh(*cmd[1:])  # gh already included above, fix below

    # Actually, let me fix the command building
    cmd = ["gh", "pr", "create"]
    if title:
        cmd.extend(["--title", title])
    if body:
        cmd.extend(["--body", body])
    if not title and not body:
        cmd.append("--fill")
    if reviewer:
        cmd.extend(["--reviewer", reviewer])
    if labels:
        cmd.extend(["--label", ",".join(labels)])

    result = run(cmd, check=False)
    if result.returncode == 0:
        pr_url = result.stdout.strip()
        print(f"\n✓ PR created: {pr_url}")
    else:
        print(f"\n✗ Failed to create PR: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)


def cmd_finish(no_delete: bool = False) -> None:
    """Merge feature branch back into base (only if CI green)."""
    branch = current_branch()

    if not branch.startswith("feature/"):
        print(f"ERROR: Not on a feature branch (current: {branch})", file=sys.stderr)
        sys.exit(1)

    # Check for open PR
    pr_list = run(["gh", "pr", "list", "--head", branch, "--json", "number,statusCheckRollup"],
                  check=False)
    if pr_list.returncode != 0 or not pr_list.stdout.strip():
        print("No open PR found for this branch.", file=sys.stderr)
        print("Open a PR first with: feature.py pr", file=sys.stderr)
        sys.exit(1)

    pr_data = json.loads(pr_list.stdout)
    if not pr_data:
        print("No open PR found.", file=sys.stderr)
        sys.exit(1)

    pr = pr_data[0]
    pr_number = pr["number"]

    # Check CI status
    checks = pr.get("statusCheckRollup", [])
    failed = [c for c in checks if c.get("conclusion") == "failure"]
    if failed:
        print(f"CI checks failing ({len(failed)} failed):", file=sys.stderr)
        for c in failed[:3]:
            print(f"  ✗ {c.get('name', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    pending = [c for c in checks if c.get("status") == "pending"]
    if pending:
        print(f"WARNING: {len(pending)} checks still pending", file=sys.stderr)

    # Determine base branch
    pr_info = run(["gh", "pr", "view", str(pr_number), "--json", "baseRefName"],
                  check=False)
    if pr_info.returncode == 0:
        base = json.loads(pr_info.stdout).get("baseRefName", "main")
    else:
        base = "main"

    # Squash merge
    print(f"Merging '{branch}' into '{base}'...")
    merge_result = run(
        ["gh", "pr", "merge", str(pr_number), "--squash", "--admin"],
        check=False,
    )
    if merge_result.returncode != 0:
        print(f"✗ Merge failed: {merge_result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    # Switch to base
    print(f"Switching to '{base}'...")
    git("checkout", base)
    run(["git", "pull"], check=False)

    # Delete branch
    if not no_delete:
        print("Deleting feature branch...")
        run(["git", "branch", "-D", branch], check=False)
        if remote_exists():
            run(["git", "push", "origin", "--delete", branch], check=False)

    print(f"\n✓ Feature '{branch}' merged and cleaned up")


def cmd_status() -> None:
    """Show current branch info, linked PR, and CI state."""
    branch = current_branch()

    print(f"Branch: {branch}")

    if not branch.startswith("feature/"):
        print("Not on a feature branch.")
        return

    # Check for PR
    pr_list = run(
        ["gh", "pr", "list", "--head", branch, "--json",
         "number,title,state,statusCheckRollup,url"],
        check=False,
    )
    if pr_list.returncode != 0 or pr_list.stdout.strip() != "[]":
        print("PR: none")
        return

    pr_data = json.loads(pr_list.stdout)
    if not pr_data:
        print("PR: none (create one with: feature.py pr)")
        return

    pr = pr_data[0]
    print(f"PR: #{pr['number']} — {pr['title']}")
    print(f"    URL: {pr['url']}")
    print(f"    State: {pr['state']}")

    # CI status
    checks = pr.get("statusCheckRollup", [])
    if checks:
        passed = sum(1 for c in checks if c.get("conclusion") == "success")
        failed = sum(1 for c in checks if c.get("conclusion") == "failure")
        pending = sum(1 for c in checks if c.get("status") == "pending")
        print(f"    CI: {passed} passed, {failed} failed, {pending} pending")
    else:
        print("    CI: no checks")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Codex-Style Git Feature Workflow"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # start
    p_start = sub.add_parser("start", help="Create feature branch")
    p_start.add_argument("name", help="Feature name (will be slugified)")
    p_start.add_argument("--base", default="main", help="Base branch (default: main)")

    # pr
    p_pr = sub.add_parser("pr", help="Open a PR")
    p_pr.add_argument("--title", "-t", help="PR title")
    p_pr.add_argument("--body", "-b", help="PR body")
    p_pr.add_argument("--reviewer", "-r", help="Reviewer username")
    p_pr.add_argument("--labels", "-l", nargs="+", help="Labels to add")

    # finish
    p_finish = sub.add_parser("finish", help="Merge and clean up")
    p_finish.add_argument("--no-delete", action="store_true",
                          help="Don't delete the feature branch")

    # status
    sub.add_parser("status", help="Show branch + PR status")

    args = parser.parse_args()

    if args.command == "start":
        cmd_start(args.name, args.base)
    elif args.command == "pr":
        cmd_pr(args.title, args.body, args.reviewer, args.labels)
    elif args.command == "finish":
        cmd_finish(args.no_delete)
    elif args.command == "status":
        cmd_status()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Check or fix logical spacing across all Rust workspace crates and targets."""

import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SPACING_CODES = {"statement_padding", "item_padding", "multiple_empty_lines", "padded_blocks"}


def check(fix=False):
    for target in [None, "x86_64-pc-windows-gnu", "x86_64-unknown-linux-gnu"]:
        status = check_target(target, fix)

        if status:
            return status

    print("Rust spacing: workspace targets and Windows/Linux Git code pass.")
    return 0


def check_target(target=None, fix=False):
    command = ["cargo", "dylint", "--all", "--fail-on-no-libraries", "--no-deps"]
    command += ["--package", "onegit-git"] if target else ["--workspace"]

    if fix:
        command.append("--fix")

    command += ["--", "--locked", "--all-targets", "--all-features", "--message-format=json", "-j", "2"]

    if target:
        command += ["--target", target]

    if fix:
        command += ["--allow-dirty", "--allow-staged"]

    result = subprocess.run(
        command,
        cwd=ROOT,
        env={**os.environ, "CARGO_TERM_COLOR": "never"},
        stdout=subprocess.PIPE,
        text=True,
        check=False,
    )
    diagnostics = []

    for line in result.stdout.splitlines():
        if not line.startswith("{"):
            continue

        event = json.loads(line)

        if event.get("reason") == "compiler-message":
            message = event["message"]

            if (message.get("code") or {}).get("code") in SPACING_CODES or message["level"] == "error":
                diagnostics.append(message)

    if fix and result.returncode == 0:
        # cargo fix can leave overlapping suggestions; only a fresh clean check passes.
        return check_target(target)

    for diagnostic in diagnostics:
        print(diagnostic.get("rendered") or diagnostic["message"])

    if result.returncode or diagnostics:
        return result.returncode or 1

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true", help="Apply suggestions, then check again")
    args = parser.parse_args()

    try:
        raise SystemExit(check(args.fix))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")

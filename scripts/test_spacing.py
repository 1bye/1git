"""Keep spacing violations and compiler failures from silently passing CI."""

import contextlib
import io
import json
import subprocess
import unittest
from unittest.mock import patch

from check_spacing import check


def result(code=None, level="warning", returncode=0):
    event = {"reason": "compiler-message", "message": {
        "code": {"code": code} if code else None,
        "level": level,
        "message": "test diagnostic",
    }}
    return subprocess.CompletedProcess([], returncode, json.dumps(event))


class SpacingChecks(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_spacing_warnings_fail_even_when_cargo_succeeds(self):
        for code in ["statement_padding", "item_padding", "multiple_empty_lines", "padded_blocks"]:
            with self.subTest(code=code), patch("check_spacing.subprocess.run", return_value=result(code)):
                self.assertEqual(check(), 1)

    def test_compilation_failures_fail_but_unrelated_warnings_do_not(self):
        for diagnostic, expected in [(result("unused_imports"), 0), (result(level="error"), 1), (result(returncode=101), 101)]:
            with self.subTest(expected=expected), patch("check_spacing.subprocess.run", return_value=diagnostic):
                self.assertEqual(check(), expected)

    def test_fix_rechecks_and_rejects_remaining_spacing(self):
        with patch("check_spacing.subprocess.run", side_effect=[result(), result("item_padding")]) as run:
            self.assertEqual(check(fix=True), 1)
            self.assertIn("--fix", run.call_args_list[0].args[0])
            self.assertNotIn("--fix", run.call_args_list[1].args[0])
            self.assertIn("--workspace", run.call_args_list[1].args[0])
            self.assertIn("--all-targets", run.call_args_list[1].args[0])
            self.assertIn("--all-features", run.call_args_list[1].args[0])

    def test_native_workspace_and_platform_specific_git_code_are_checked(self):
        with patch("check_spacing.subprocess.run", return_value=result()) as run:
            self.assertEqual(check(), 0)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(len(commands), 3)
            self.assertIn("--workspace", commands[0])
            self.assertIn("onegit-git", commands[1])
            self.assertIn("x86_64-pc-windows-gnu", commands[1])
            self.assertIn("onegit-git", commands[2])
            self.assertIn("x86_64-unknown-linux-gnu", commands[2])

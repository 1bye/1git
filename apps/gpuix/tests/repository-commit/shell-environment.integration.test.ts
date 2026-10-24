/**
 * Covers: GUI-like PATH recovery for real Git hooks, noisy startup files and bounded shell startup.
 * Real: zsh login/interactive startup, Git and executable lookup in isolated repositories.
 * Doubles: temporary bun/node executables and user startup files; no real preferences or accounts.
 * Requires: macOS, zsh, Git and writable temporary storage.
 */
import { afterEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { ShellEnvironment } from "../../src/shell-environment";

const directories = new Set<string>();
const execute = promisify(execFile);

afterEach(async () => {
	for (const directory of directories)
		await rm(directory, { recursive: true, force: true });

	directories.clear();
});

it("runs bun and node hooks after restoring a noisy login shell's PATH, without blocking the event loop", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git shell "));

	directories.add(directory);
	const tools = join(directory, "tools");

	await mkdir(tools);

	for (const tool of ["bun", "node"])
		await writeFile(
			join(tools, tool),
			`#!/bin/sh\nprintf '${tool} available\\n'\n`,
			{ mode: 0o700 }
		);

	await writeFile(
		join(directory, ".zshrc"),
		`printf 'startup chatter\\n'\nexport PATH='${tools}:/usr/bin:/bin'\n`
	);
	const env: NodeJS.ProcessEnv = {
		PATH: "/usr/bin:/bin",
		SHELL: "/bin/zsh",
		ZDOTDIR: directory,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	};

	const git = async (args: string[]) =>
		await execute("/usr/bin/git", args, { cwd: directory, env });

	await git(["init", "--initial-branch=main"]);
	await git(["config", "user.name", "Hook Test"]);
	await git(["config", "user.email", "hook@test.invalid"]);
	await git(["config", "commit.gpgsign", "false"]);
	await writeFile(join(directory, "file.txt"), "selected\n");
	await git(["add", "file.txt"]);
	await writeFile(
		join(directory, ".git/hooks/pre-commit"),
		"#!/bin/sh\nset -e\nbun --version\nnode --version\n",
		{ mode: 0o700 }
	);

	await expect(git(["commit", "-m", "Missing tools"])).rejects.toThrow("bun");
	const environment = new ShellEnvironment(env, directory);
	const loading = environment.prepare();

	expect(environment.prepare()).toBe(loading);
	await Bun.sleep(0);
	await loading;
	expect(env.PATH?.split(":")[0]).toBe(tools);
	expect(env.PATH).not.toContain("startup chatter");
	const result = await git(["commit", "-m", "Hook tools found"]);

	expect(result.stdout + result.stderr).toContain("bun available");
	expect(result.stdout + result.stderr).toContain("node available");
	expect((await git(["show", "HEAD:file.txt"])).stdout).toBe("selected\n");
}, 15000);

it("kills a stalled shell and its children, then retains a usable fallback PATH", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-shell-timeout-"));

	directories.add(directory);
	const shell = join(directory, "shell");
	const marker = join(directory, "late-child");

	await writeFile(
		shell,
		`#!/bin/sh\n(/bin/sleep 0.3; /usr/bin/touch '${marker}') &\nwait\n`,
		{ mode: 0o700 }
	);
	const env = { PATH: "/usr/bin:/bin", SHELL: shell };
	const loading = new ShellEnvironment(env, directory, 50).prepare();

	await loading;
	expect(env.PATH).toContain(join(directory, ".bun/bin"));
	expect(env.PATH).toContain("/opt/homebrew/bin");
	await Bun.sleep(400);
	await expect(readFile(marker)).rejects.toThrow();
});

it("falls back when a shell is unavailable and excludes relative executable search paths", async () => {
	const env = { PATH: ".::/custom/bin", SHELL: "/nonexistent/1git-test-shell" };

	await new ShellEnvironment(env, tmpdir()).prepare();

	expect(env.PATH.split(":")).toContain("/custom/bin");
	expect(env.PATH.split(":")).not.toContain("");
	expect(env.PATH.split(":")).not.toContain(".");
});

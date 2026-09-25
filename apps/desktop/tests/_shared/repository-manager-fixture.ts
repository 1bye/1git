import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
	RepositoryManager,
	type RepositoryManagerOptions,
} from "../../src/main/git/repository-manager.js";
import type { RepositoryManagerResult } from "../../src/shared/repository-session.js";

const execFileAsync = promisify(execFile);
const TEST_START_TIME = Date.parse("2026-01-01T00:00:00.000Z");

const runGit = async (cwd: string, args: readonly string[]): Promise<void> => {
	await execFileAsync("git", args, {
		cwd,
		env: {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_TERMINAL_PROMPT: "0",
			LC_ALL: "C",
		},
	});
};

export interface RepositoryFixture {
	readonly path: (relativePath: string) => string;
	readonly repositoryPath: string;
	readonly root: string;
	readonly write: (relativePath: string, content: string) => Promise<string>;
}

export class RepositoryFixtures {
	private readonly roots = new Set<string>();

	async create(): Promise<RepositoryFixture> {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "1git-desktop-manager-"))
		);
		this.roots.add(root);
		const repositoryPath = join(root, "repository");
		await mkdir(repositoryPath);
		await runGit(repositoryPath, ["init", "--initial-branch=main"]);
		await runGit(repositoryPath, ["config", "user.name", "1git Test"]);
		await runGit(repositoryPath, ["config", "user.email", "tests@1git.local"]);
		await runGit(repositoryPath, ["config", "core.hooksPath", ".git/no-hooks"]);
		await writeFile(join(repositoryPath, "README.md"), "# Test repository\n");
		await runGit(repositoryPath, ["add", "--all"]);
		await runGit(repositoryPath, ["commit", "-m", "Initial commit"]);
		const canonicalRepositoryPath = await realpath(repositoryPath);

		return {
			path: (relativePath: string): string =>
				join(canonicalRepositoryPath, relativePath),
			repositoryPath: canonicalRepositoryPath,
			root,
			write: async (relativePath: string, content: string): Promise<string> => {
				const path = join(canonicalRepositoryPath, relativePath);
				await mkdir(join(path, ".."), { recursive: true });
				await writeFile(path, content);
				return path;
			},
		};
	}

	async createNonRepository(): Promise<string> {
		const path = await realpath(
			await mkdtemp(join(tmpdir(), "1git-desktop-not-repository-"))
		);
		this.roots.add(path);
		return path;
	}

	async createBlockingGitExecutable(): Promise<string> {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "1git-desktop-blocking-git-"))
		);
		this.roots.add(root);
		const executablePath = join(root, "blocking-git.cjs");
		await writeFile(
			executablePath,
			[
				"#!/usr/bin/env node",
				"const timer = setInterval(() => undefined, 1000);",
				"const stop = () => {",
				"  clearInterval(timer);",
				"  process.exit(143);",
				"};",
				'process.on("SIGINT", stop);',
				'process.on("SIGTERM", stop);',
				"",
			].join("\n")
		);
		await chmod(executablePath, 0o755);
		return executablePath;
	}

	async cleanup(): Promise<void> {
		await Promise.all(
			[...this.roots].map(async (root) => {
				await rm(root, { force: true, recursive: true });
			})
		);
		this.roots.clear();
	}
}

export const createTestRepositoryManager = (
	options: RepositoryManagerOptions = {}
): RepositoryManager => {
	let nextId = 0;
	let currentTime = TEST_START_TIME;
	return new RepositoryManager({
		...options,
		createSessionId:
			options.createSessionId ??
			(() => {
				nextId += 1;
				return `session-${nextId}`;
			}),
		now:
			options.now ??
			(() => {
				const now = new Date(currentTime);
				currentTime += 1000;
				return now;
			}),
	});
};

export const unwrapManagerResult = <T>(
	result: RepositoryManagerResult<T>
): T => {
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
};

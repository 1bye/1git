import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { GitResult } from "../../src/contracts.js";
import { GitProcess } from "../../src/process/git-process.js";
import { GitRepository } from "../../src/repository.js";

const TEST_USER_NAME = "1git Test";
const TEST_USER_EMAIL = "tests@1git.local";

export interface RepositoryFixtureOptions {
	readonly initialCommit?: boolean;
}

/** Throws a readable setup failure while preserving type narrowing in tests. */
export const unwrapResult = <T>(result: GitResult<T>): T => {
	if (!result.ok) {
		throw new Error(
			`${result.error.operation}: ${result.error.message}\n${result.error.details ?? ""}`
		);
	}

	return result.value;
};

/** Isolated real repository used by integration tests. */
export class RepositoryFixture {
	readonly repository: GitRepository;
	readonly repositoryPath: string;
	readonly sandboxPath: string;
	private readonly process = new GitProcess();

	private constructor(
		sandboxPath: string,
		repositoryPath: string,
		repository: GitRepository
	) {
		this.repository = repository;
		this.repositoryPath = repositoryPath;
		this.sandboxPath = sandboxPath;
	}

	static async create(
		options: RepositoryFixtureOptions = {}
	): Promise<RepositoryFixture> {
		const createdSandboxPath = await mkdtemp(join(tmpdir(), "onegit-tests-"));
		const sandboxPath = await realpath(createdSandboxPath);
		const requestedRepositoryPath = join(sandboxPath, "repository");
		const process = new GitProcess();

		await process.run({
			args: ["init", "--initial-branch=main", "--", requestedRepositoryPath],
			cwd: sandboxPath,
		});
		const repositoryPath = await realpath(requestedRepositoryPath);

		await process.run({
			args: ["config", "--local", "user.name", TEST_USER_NAME],
			cwd: repositoryPath,
		});
		await process.run({
			args: ["config", "--local", "user.email", TEST_USER_EMAIL],
			cwd: repositoryPath,
		});

		if (options.initialCommit !== false) {
			await writeFile(join(repositoryPath, "README.md"), "# Test repository\n");
			await process.run({
				args: ["add", "--", "README.md"],
				cwd: repositoryPath,
			});
			await process.run({
				args: ["commit", "-m", "initial commit"],
				cwd: repositoryPath,
			});
		}

		const repository = unwrapResult(
			await GitRepository.open({ path: repositoryPath })
		);

		return new RepositoryFixture(sandboxPath, repositoryPath, repository);
	}

	async cleanup(): Promise<void> {
		await rm(this.sandboxPath, { force: true, recursive: true });
	}

	path(name: string): string {
		return join(this.sandboxPath, name);
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		const absolutePath = join(this.repositoryPath, path);

		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content);
	}

	async read(path: string): Promise<string> {
		return await readFile(join(this.repositoryPath, path), "utf8");
	}

	async remove(path: string): Promise<void> {
		await unlink(join(this.repositoryPath, path));
	}

	async rename(currentPath: string, newPath: string): Promise<void> {
		const absoluteNewPath = join(this.repositoryPath, newPath);

		await mkdir(dirname(absoluteNewPath), { recursive: true });
		await rename(join(this.repositoryPath, currentPath), absoluteNewPath);
	}

	async git(args: readonly string[], stdin?: string): Promise<string> {
		const output = await this.process.run({
			args,
			cwd: this.repositoryPath,
			stdin,
		});

		return output.stdout.toString("utf8").trimEnd();
	}

	async commitAll(summary: string): Promise<string> {
		await this.git(["add", "--all"]);
		await this.git(["commit", "-m", summary]);

		return await this.git(["rev-parse", "HEAD"]);
	}

	async createBareRemote(name = "remote.git"): Promise<string> {
		const path = this.path(name);

		await this.process.run({
			args: ["init", "--bare", "--initial-branch=main", "--", path],
			cwd: this.sandboxPath,
		});

		return path;
	}
}

/** File-local fixture registry for deterministic afterEach cleanup. */
export class RepositoryFixtures {
	private readonly fixtures: RepositoryFixture[] = [];

	async create(
		options: RepositoryFixtureOptions = {}
	): Promise<RepositoryFixture> {
		const fixture = await RepositoryFixture.create(options);

		this.fixtures.push(fixture);

		return fixture;
	}

	async cleanup(): Promise<void> {
		const fixtures = this.fixtures.splice(0);

		await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
	}
}

import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	loadRepositoryView,
	openRepository,
	unwrapGitResult,
} from "../src/model";

const temporaryRepositories: string[] = [];
const execFileAsync = promisify(execFile);

const runGit = async (repositoryPath: string, args: readonly string[]) => {
	await execFileAsync("git", [...args], { cwd: repositoryPath });
};

const createRepository = async (): Promise<string> => {
	const repositoryPath = await mkdtemp(join(tmpdir(), "1git-gpuix-"));
	temporaryRepositories.push(repositoryPath);
	await runGit(repositoryPath, ["init", "--initial-branch=main"]);
	await runGit(repositoryPath, ["config", "user.name", "GPUix Test"]);
	await runGit(repositoryPath, ["config", "user.email", "gpuix@example.test"]);
	await writeFile(join(repositoryPath, "README.md"), "before\n");
	await runGit(repositoryPath, ["add", "README.md"]);
	await runGit(repositoryPath, ["commit", "-m", "Initial commit"]);
	return repositoryPath;
};

afterEach(async () => {
	await Promise.all(
		temporaryRepositories.map(async (repositoryPath) =>
			rm(repositoryPath, { force: true, recursive: true })
		)
	);
	temporaryRepositories.length = 0;
});

describe("repository vertical slice", () => {
	it("loads, stages, unstages, and commits a real patch", async () => {
		const repositoryPath = await createRepository();
		await writeFile(join(repositoryPath, "README.md"), "after\n");
		const repository = await openRepository(repositoryPath);

		const workingView = await loadRepositoryView(repository, null);
		expect(workingView.unstagedFiles.map((file) => file.path)).toEqual([
			"README.md",
		]);
		expect(workingView.patch).toContain("+after");

		unwrapGitResult(await repository.stage({ paths: ["README.md"] }));
		const stagedView = await loadRepositoryView(repository, "README.md");
		expect(stagedView.selectedPath).toBe("README.md");
		expect(stagedView.stagedFiles).toHaveLength(1);
		expect(stagedView.unstagedFiles).toHaveLength(0);
		expect(stagedView.patch).toContain("+after");

		unwrapGitResult(await repository.unstage({ paths: ["README.md"] }));
		const unstagedView = await loadRepositoryView(repository, null);
		expect(unstagedView.stagedFiles).toHaveLength(0);
		expect(unstagedView.unstagedFiles).toHaveLength(1);

		unwrapGitResult(await repository.stageAll());
		unwrapGitResult(
			await repository.commit({ summary: "Commit through the GPUix slice" })
		);
		const committedView = await loadRepositoryView(repository, null);
		expect(committedView.snapshot.files).toHaveLength(0);
		expect(committedView.patch).toBe("");
	});
});

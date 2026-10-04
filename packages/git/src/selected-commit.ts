import {
	copyFile,
	lstat,
	mkdtemp,
	open,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
	CommitFilesInput,
	CommitFilesResult,
	RepositorySnapshot,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { requireRepositoryPaths, requireText } from "./validation.js";

/** Owns a selected-file transaction; Git's --only commit handles excluded staging in an isolated index. */
export class SelectedCommit {
	private constructor() {}

	static async run(
		context: RepositoryContext,
		input: CommitFilesInput
	): Promise<CommitFilesResult> {
		const staged = input.mode === "staged";
		const paths = staged ? [] : requireRepositoryPaths(input.paths, "commit");

		const message = requireText(
			input.message.trim(),
			"Commit message",
			"commit"
		);

		if (!input.message.split("\n", 1)[0]?.trim())
			throw invalidInput("commit", "A first-line summary is required.");

		const location = await context.process.run({
			args: ["rev-parse", "--path-format=absolute", "--git-path", "index"],
			cwd: context.repository.root,
			signal: input.signal,
		});

		const indexPath = location.stdout.toString("utf8").replace(/\r?\n$/, "");
		const lockPath = `${indexPath}.lock`;

		const lock = await open(lockPath, "wx").catch((error: unknown) => {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "EEXIST"
			)
				throw invalidInput(
					"commit",
					"The repository is locked by another Git process.",
					"repository-locked"
				);

			throw error;
		});

		let directory: string | undefined;
		let ownsLock = true;
		let retainRecovery = false;
		let outcome: CommitFilesResult["outcome"] = "committed";
		let warning: string | null = null;
		let oid: string | null = null;
		let committed = false;
		let failure: { error: unknown } | undefined;

		try {
			await lock.close();
			const snapshot = await loadSnapshot(context, false, input.signal);
			const selectedPaths = SelectedCommit.paths(snapshot, input, paths);

			if (!staged)
				await SelectedCommit.checkFilePaths(
					context.repository.root,
					selectedPaths
				);

			const stagePaths = snapshot.files
				.filter(
					(file) => paths.includes(file.path) && file.indexStatus !== "deleted"
				)
				.flatMap((file) =>
					file.worktreeStatus === "renamed" && file.originalPath
						? [file.originalPath, file.path]
						: [file.path]
				);

			directory = await mkdtemp(
				join(context.repository.gitDirectory, "1git-commit-")
			);
			const indexFile = join(directory, "index");
			const pathFile = join(directory, "paths");

			const run = async (args: readonly string[], stdin?: string) =>
				await context.process.run({
					args,
					cwd: context.repository.root,
					indexFile,
					stdin,
				});

			// From here the transaction is not cancelled by navigation or AbortSignal.
			// Never leave Git running while removing its temporary index.
			try {
				await copyFile(indexPath, indexFile);
			} catch (error) {
				if (
					!(
						error &&
						typeof error === "object" &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;

				await run(["read-tree", "--empty"]);
			}

			if (!staged && stagePaths.length) {
				await run(
					[
						"--literal-pathspecs",
						"add",
						"--all",
						"--pathspec-from-file=-",
						"--pathspec-file-nul",
					],
					`${stagePaths.join("\0")}\0`
				);
			}

			await writeFile(pathFile, `${selectedPaths.join("\0")}\0`, {
				mode: 0o600,
			});

			// External ref updates do not take the index lock. Recheck immediately before the write.
			SelectedCommit.paths(await loadSnapshot(context), input, paths);

			if (!staged)
				await SelectedCommit.checkFilePaths(
					context.repository.root,
					selectedPaths
				);

			try {
				await run(
					staged
						? ["commit", "-F", "-"]
						: [
								"--literal-pathspecs",
								"commit",
								"--only",
								`--pathspec-from-file=${pathFile}`,
								"--pathspec-file-nul",
								"-F",
								"-",
							],
					`${message}\n`
				);
				committed = true;
			} catch (error) {
				// Hooks can fail after updating HEAD. Never report an ordinary retryable failure in that case.
				let after: RepositorySnapshot | undefined;

				try {
					after = await loadSnapshot(context);
				} catch {
					/* Outcome remains unknown. */
				}

				if (
					after &&
					after.head.oid === snapshot.head.oid &&
					after.head.branch === snapshot.head.branch
				)
					throw error;

				outcome = "unknown";
				retainRecovery = true;
				oid = after?.head.oid ?? null;
				warning = `Commit outcome is uncertain. Inspect History before retrying. The original index is unchanged; recovery files are in ${directory}.`;
			}

			if (committed) {
				try {
					await copyFile(indexFile, lockPath);
					await rename(lockPath, indexPath);
					ownsLock = false;
				} catch {
					retainRecovery = true;
					warning = `Commit created, but the index could not be updated. Do not recommit. Recovery index: ${indexFile}.`;
				}
			}
		} catch (error) {
			failure = { error };
		} finally {
			try {
				if (ownsLock) await rm(lockPath, { force: true });

				if (directory && !retainRecovery)
					await rm(directory, { recursive: true, force: true });
			} catch (error) {
				if (!committed && outcome !== "unknown") failure ??= { error };
				else
					warning = `${warning ?? "Commit created."} Transaction cleanup failed. Inspect ${directory ?? lockPath} before continuing.`;
			}
		}

		if (failure) throw failure.error;

		let snapshot: RepositorySnapshot | null = null;

		try {
			snapshot = await loadSnapshot(context);
			oid = snapshot.head.oid;
		} catch {
			warning ??=
				"Commit created, but refreshing the repository failed. Refresh before committing again.";
		}

		return { outcome, oid, snapshot, warning };
	}

	private static async checkFilePaths(
		root: string,
		paths: readonly string[]
	): Promise<void> {
		for (const path of paths) {
			const info = await lstat(join(root, path)).catch((error: unknown) => {
				if (
					error &&
					typeof error === "object" &&
					"code" in error &&
					(error.code === "ENOENT" || error.code === "ENOTDIR")
				)
					return null;

				throw error;
			});

			// Literal Git pathspecs still match descendants of directories.
			if (info?.isDirectory())
				throw invalidInput(
					"commit",
					`“${path}” is now a directory. Resolve this file/directory change in Git before committing here.`
				);
		}
	}

	private static paths(
		snapshot: RepositorySnapshot,
		input: CommitFilesInput,
		paths: readonly string[]
	): readonly string[] {
		if (
			snapshot.head.oid !== input.expectedHead ||
			snapshot.head.branch !== input.expectedBranch
		)
			throw invalidInput(
				"commit",
				"HEAD or the branch changed. Refresh and review your selection before committing."
			);

		if (
			snapshot.operationState !== "normal" ||
			snapshot.files.some((file) => file.recordType === "unmerged")
		)
			throw invalidInput(
				"commit",
				"Finish the merge, rebase or conflict resolution before committing here.",
				"conflict"
			);

		if (input.mode === "staged") {
			const staged = snapshot.files.filter(
				(file) =>
					file.recordType !== "untracked" &&
					file.recordType !== "ignored" &&
					file.indexStatus !== "unmodified"
			);

			if (!staged.length)
				throw invalidInput("commit", "Stage changes before committing.");

			return staged.map((file) => file.path);
		}

		const selected = new Set<string>();

		for (const path of paths) {
			const file = snapshot.files.find((entry) => entry.path === path);

			if (!file || file.recordType === "ignored")
				throw invalidInput(
					"commit",
					`“${path}” is no longer a changed file. Refresh before committing.`
				);

			if (file.submodule !== "N...")
				throw invalidInput(
					"commit",
					`Commit submodule changes in Git first: ${path}`
				);

			if (
				!input.includePartialStaging &&
				file.recordType !== "untracked" &&
				file.indexStatus !== "unmodified" &&
				file.worktreeStatus !== "unmodified"
			)
				throw invalidInput(
					"commit",
					`“${path}” is partially staged. Stage or unstage the whole file in Git, then refresh, or exclude it from this commit.`
				);

			selected.add(file.path);

			if (
				file.originalPath &&
				(file.indexStatus === "renamed" || file.worktreeStatus === "renamed")
			) {
				if (snapshot.files.some((other) => other.path === file.originalPath))
					throw invalidInput(
						"commit",
						`The renamed source “${file.originalPath}” also has changes. Resolve the rename in Git before committing here.`
					);

				selected.add(file.originalPath);
			}
		}

		return [...selected];
	}
}

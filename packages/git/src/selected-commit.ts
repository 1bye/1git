import {
	copyFile,
	lstat,
	mkdtemp,
	open,
	rename,
	rm,
	writeFile,
} from "./runtime.js";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import type {
	CommitFilesInput,
	CommitFilesResult,
	RepositorySnapshot,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadDiff, loadSnapshot } from "./queries.js";
import { PartialPatch } from "./partial-patch.js";
import { CommitRecovery } from "./commit-recovery.js";
import { invalidInput } from "./result.js";
import { requireRepositoryPaths, requireText } from "./validation.js";

/** Commits selected files or lines using isolated indexes, preserving excluded staging and working edits. */
export class SelectedCommit {
	private constructor() {}

	static async run(
		context: RepositoryContext,
		input: CommitFilesInput
	): Promise<CommitFilesResult> {
		input.onProgress?.({ phase: "preparing" });
		const staged = input.mode === "staged";

		if (input.amend && staged)
			throw invalidInput(
				"commit",
				"Amend uses selected files, not staged mode."
			);

		const paths =
			staged || (input.amend && input.paths.length === 0)
				? []
				: requireRepositoryPaths(input.paths, "commit");

		const amendment = input.amend
			? {
					expectedHead: input.expectedHead ?? "",
					expectedBranch: input.expectedBranch ?? "",
				}
			: null;

		const partials = input.partialFiles ?? [];
		const partialPaths = new Set(partials.map((file) => file.path));

		if (
			partialPaths.size !== partials.length ||
			partials.some((file) => !paths.includes(file.path)) ||
			(staged && partials.length)
		)
			throw invalidInput(
				"commit",
				"Partial selections must belong to selected files."
			);

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

			if (amendment) await CommitRecovery.read(context, amendment);

			if (!staged)
				await SelectedCommit.checkFilePaths(
					context.repository.root,
					selectedPaths
				);

			const stagePaths = snapshot.files
				.filter(
					(file) =>
						paths.includes(file.path) &&
						!partialPaths.has(file.path) &&
						file.indexStatus !== "deleted"
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

			const commitIndex = partials.length
				? join(directory, "commit-index")
				: indexFile;

			const pathFile = join(directory, "paths");

			const run = async (args: readonly string[], stdin?: string) =>
				await context.process.run({
					args,
					cwd: context.repository.root,
					indexFile,
					stdin,
				});

			// Preparation and cleanup own the index. Only the commit subprocess is cancellable;
			// it must finish exiting before we inspect HEAD or remove recovery files.
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

			if (partials.length) {
				await context.process.run({
					args: ["read-tree", snapshot.head.oid ?? "--empty"],
					cwd: context.repository.root,
					indexFile: commitIndex,
				});
				const wholePaths = selectedPaths.filter(
					(path) => !partialPaths.has(path)
				);

				if (wholePaths.length)
					await context.process.run({
						args: [
							"--literal-pathspecs",
							"add",
							"--all",
							"--pathspec-from-file=-",
							"--pathspec-file-nul",
						],
						cwd: context.repository.root,
						indexFile: commitIndex,
						stdin: `${wholePaths.join("\0")}\0`,
					});

				for (const file of partials) {
					await SelectedCommit.checkPartial(
						context,
						file.path,
						file.expectedPatch
					);
					let patch: string;

					try {
						patch = new PartialPatch(file.expectedPatch).select(
							file.includedLines
						);
					} catch (error) {
						throw invalidInput(
							"commit",
							error instanceof Error ? error.message : "Invalid line selection."
						);
					}

					await context.process.run({
						args: ["apply", "--cached", "--whitespace=nowarn", "-"],
						cwd: context.repository.root,
						indexFile: commitIndex,
						stdin: patch,
					});
				}
			}

			await writeFile(pathFile, `${selectedPaths.join("\0")}\0`, {
				mode: 0o600,
			});

			// External ref updates do not take the index lock. Recheck immediately before the write.
			SelectedCommit.paths(await loadSnapshot(context), input, paths);

			for (const file of partials)
				await SelectedCommit.checkPartial(
					context,
					file.path,
					file.expectedPatch
				);

			if (!staged)
				await SelectedCommit.checkFilePaths(
					context.repository.root,
					selectedPaths
				);

			if (amendment) await CommitRecovery.retainForAmend(context, amendment);

			const commitArgs = ["commit", "-F", "-"];

			if (amendment) commitArgs.push("--amend");

			if (!staged && !partials.length) {
				commitArgs.unshift("--literal-pathspecs");
				commitArgs.push("--only");

				if (selectedPaths.length)
					commitArgs.push(
						`--pathspec-from-file=${pathFile}`,
						"--pathspec-file-nul"
					);
			}

			input.onProgress?.({ phase: "committing" });
			const decoders = {
				stdout: new StringDecoder("utf8"),
				stderr: new StringDecoder("utf8"),
			};

			try {
				await context.process.run({
					cwd: context.repository.root,
					indexFile: commitIndex,
					args: commitArgs,
					stdin: `${message}\n`,
					signal: input.signal,
					onOutput: input.onProgress
						? (chunk, stream) => {
								const output = decoders[stream].write(chunk);

								if (output) input.onProgress?.({ phase: "committing", output });
							}
						: undefined,
				});
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
			} finally {
				const output = decoders.stdout.end() + decoders.stderr.end();

				if (output) input.onProgress?.({ phase: "committing", output });
			}

			if (committed) {
				try {
					// Hooks may reformat and restage selected files. Reconcile those paths
					// with the actual commit while leaving excluded index entries intact.
					if (!staged && selectedPaths.length)
						await run([
							"--literal-pathspecs",
							"reset",
							"-q",
							"HEAD",
							`--pathspec-from-file=${pathFile}`,
							"--pathspec-file-nul",
						]);

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

		input.onProgress?.({ phase: "refreshing" });

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

	private static async checkPartial(
		context: RepositoryContext,
		path: string,
		expectedPatch: string
	): Promise<void> {
		const current = await loadDiff(context, {
			paths: [path],
			target: { kind: "changes" },
		});

		if (current.patch !== expectedPatch)
			throw invalidInput(
				"commit",
				`“${path}” changed since you selected lines. Refresh and review its inclusion before committing.`
			);
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

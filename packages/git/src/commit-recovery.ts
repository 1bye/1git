import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
	CommitInfo,
	CommitRecoveryInput,
	UndoCommitResult,
	ResetCommitInput,
	ResetCommitPlan,
	ResetCommitResult,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadCommit, loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { requireRevision } from "./validation.js";
import { GitCommandFailure } from "./process/git-process.js";

const exactOid = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

/** Local-only history recovery, guarded by reviewed identity and known remote reachability. */
export class CommitRecovery {
	/** Reviews an ancestor and every removed commit against locally known remote history. */
	static async readReset(
		context: RepositoryContext,
		input: ResetCommitInput
	): Promise<ResetCommitPlan> {
		if (!exactOid.test(input.target) || !exactOid.test(input.expectedHead))
			throw invalidInput("reset", "Select an exact commit from History.");

		if (context.repository.isShallow)
			throw invalidInput(
				"reset",
				"Fetch the full history before resetting a shallow repository."
			);

		const snapshot = await loadSnapshot(context, false, input.signal);

		if (
			!input.expectedBranch ||
			snapshot.head.detached ||
			snapshot.head.oid !== input.expectedHead ||
			snapshot.head.branch !== input.expectedBranch
		)
			throw invalidInput(
				"reset",
				"The branch changed. Refresh and select the commit again."
			);

		if (snapshot.operationState !== "normal" || snapshot.files.length)
			throw invalidInput(
				"reset",
				"Commit or stash your changes and finish the current Git operation first. Nothing has been discarded."
			);

		if (input.target === input.expectedHead)
			throw invalidInput(
				"reset",
				"Choose a commit before the current branch tip."
			);

		try {
			await context.process.run({
				args: ["merge-base", "--is-ancestor", input.target, input.expectedHead],
				cwd: context.repository.root,
				signal: input.signal,
			});
		} catch (cause) {
			if (cause instanceof GitCommandFailure && cause.exitCode === 1)
				throw invalidInput(
					"reset",
					"Select an ancestor of the current branch tip."
				);

			throw cause;
		}

		const count = async (unpublished: boolean): Promise<number> => {
			const result = await context.process.run({
				args: [
					"rev-list",
					"--count",
					input.expectedHead,
					`^${input.target}`,
					...(unpublished ? ["--not", "--remotes"] : []),
				],
				cwd: context.repository.root,
				signal: input.signal,
			});

			const value = Number(result.stdout.toString().trim());

			if (!Number.isSafeInteger(value) || value < 0)
				throw invalidInput("reset", "Could not count the commits to reset.");

			return value;
		};

		const [target, commitCount, unpublishedCount] = await Promise.all([
			loadCommit(context, input.target, input.signal),
			count(false),
			count(true),
		]);

		if (target.oid !== input.target || commitCount === 0)
			throw invalidInput(
				"reset",
				"Select an exact earlier commit from History."
			);

		if (unpublishedCount !== commitCount)
			throw invalidInput(
				"reset",
				"Later commits are published according to known remote branches. Only unpublished commits can be reset. Fetch first if another tool may have pushed."
			);

		return { target, commitCount };
	}

	/** Atomically retains the old tip and moves only the reviewed branch, without replacing files or staging. */
	static async reset(
		context: RepositoryContext,
		input: ResetCommitInput
	): Promise<ResetCommitResult> {
		const lockPath = join(context.repository.gitDirectory, "index.lock");

		const lock = await open(lockPath, "wx").catch((cause: unknown) => {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "EEXIST"
			)
				throw invalidInput(
					"reset",
					"Another Git process has locked the index.",
					"repository-locked"
				);

			throw cause;
		});

		const recoveryRef = `refs/1git/reset/${randomUUID()}`;
		let warning: string | null = null;
		let failure: { cause: unknown } | undefined;

		try {
			await lock.close();
			await CommitRecovery.readReset(context, input);
			// The compare-and-swap and recovery ref commit together; cancellation cannot interrupt installation.
			await context.process.run({
				args: ["update-ref", "-m", "1git: reset to commit", "--stdin"],
				cwd: context.repository.root,
				stdin: `start\ncreate ${recoveryRef} ${input.expectedHead}\nupdate refs/heads/${input.expectedBranch} ${input.target} ${input.expectedHead}\nprepare\ncommit\n`,
			});
		} catch (cause) {
			failure = { cause };
		} finally {
			try {
				await rm(lockPath);
			} catch {
				warning = `Could not release ${lockPath}. Inspect History and the lock before continuing.`;
			}
		}

		if (failure) {
			if (warning)
				throw invalidInput(
					"reset",
					`Reset could not be confirmed. Refresh and inspect History. ${warning}`
				);

			throw failure.cause;
		}

		let snapshot: ResetCommitResult["snapshot"] = null;

		try {
			snapshot = await loadSnapshot(context);

			if (
				snapshot.head.oid !== input.target ||
				snapshot.head.branch !== input.expectedBranch
			)
				warning = `Reset completed, but the branch changed externally. Refresh and inspect History. Originals: ${recoveryRef}. ${warning ?? ""}`;
		} catch {
			warning = `Reset completed; refresh failed. Refresh and inspect History. Originals: ${recoveryRef}. ${warning ?? ""}`;
		}

		return { snapshot, recoveryRef, warning };
	}

	static async read(
		context: RepositoryContext,
		input: CommitRecoveryInput
	): Promise<CommitInfo> {
		const snapshot = await loadSnapshot(context, false, input.signal);

		if (
			!input.expectedHead ||
			!input.expectedBranch ||
			snapshot.head.oid !== input.expectedHead ||
			snapshot.head.branch !== input.expectedBranch ||
			snapshot.head.detached
		)
			throw invalidInput(
				"commit",
				"HEAD or the branch changed. Refresh before editing the last commit."
			);

		if (
			snapshot.operationState !== "normal" ||
			snapshot.files.some((file) => file.recordType === "unmerged")
		)
			throw invalidInput(
				"commit",
				"Finish the current Git operation and resolve conflicts first."
			);

		const oid = requireRevision(input.expectedHead, "Commit", "commit");

		const published = await context.process.run({
			args: [
				"for-each-ref",
				`--contains=${oid}`,
				"--format=%(refname)",
				"refs/remotes/",
			],
			cwd: context.repository.root,
			signal: input.signal,
		});

		if (published.stdout.toString("utf8").trim())
			throw invalidInput(
				"commit",
				"This commit is already published according to the known remote branches. History editing is only available for unpublished commits."
			);

		const commit = await loadCommit(context, oid, input.signal);

		if (commit.parentOids.length > 1)
			throw invalidInput(
				"commit",
				"Editing merge commits requires external Git tools."
			);

		return commit;
	}

	/** Retains the reviewed tip before amendment, verifying its branch in the same ref transaction. */
	static async retainForAmend(
		context: RepositoryContext,
		input: CommitRecoveryInput
	): Promise<void> {
		const commit = await CommitRecovery.read(context, input);
		const recoveryRef = `refs/1git/amend/${randomUUID()}`;

		await context.process.run({
			args: ["update-ref", "-m", "1git: retain amended commit", "--stdin"],
			cwd: context.repository.root,
			stdin: `start\nverify refs/heads/${input.expectedBranch} ${commit.oid}\ncreate ${recoveryRef} ${commit.oid}\nprepare\ncommit\n`,
		});
	}

	static async undo(
		context: RepositoryContext,
		input: CommitRecoveryInput
	): Promise<UndoCommitResult> {
		const commit = await CommitRecovery.read(context, input);
		const branch = `refs/heads/${input.expectedBranch}`;
		const recoveryRef = `refs/1git/undo/${randomUUID()}`;
		const parent = commit.parentOids[0];

		// Compare-and-swap the exact reviewed branch and retain its old commit atomically.
		const change = parent
			? `update ${branch} ${parent} ${commit.oid}`
			: `delete ${branch} ${commit.oid}`;

		await context.process.run({
			args: ["update-ref", "-m", "1git: undo last commit", "--stdin"],
			cwd: context.repository.root,
			stdin: `start\ncreate ${recoveryRef} ${commit.oid}\n${change}\nprepare\ncommit\n`,
		});

		let snapshot: UndoCommitResult["snapshot"] = null;
		let warning: string | null = null;

		try {
			snapshot = await loadSnapshot(context);

			if (
				snapshot.head.branch !== input.expectedBranch ||
				snapshot.head.oid !== (parent ?? null)
			)
				warning =
					"Undo completed, but the branch changed externally. Refresh and inspect History before continuing.";
		} catch {
			warning =
				"Commit undone, but refreshing failed. Refresh before continuing.";
		}

		return {
			snapshot,
			message: commit.body || commit.summary,
			recoveryRef,
			warning,
		};
	}
}

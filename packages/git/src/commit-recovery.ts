import { randomUUID } from "node:crypto";
import type {
	CommitInfo,
	CommitRecoveryInput,
	UndoCommitResult,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { loadCommit, loadSnapshot } from "./queries.js";
import { invalidInput } from "./result.js";
import { requireRevision } from "./validation.js";

/** Local-only history recovery, guarded by reviewed identity and known remote reachability. */
export class CommitRecovery {
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

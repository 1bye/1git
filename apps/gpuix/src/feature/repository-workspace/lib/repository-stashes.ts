import { type GitResult, type StashInfo } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";
import { RepositoryHistory } from "./repository-history";

const stashDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Explicit whole-worktree intent; deletion targets the reviewed immutable stash ID. */
export type StashRequest =
	| {
			readonly kind: "create";
			readonly message: string;
			readonly includeUntracked: boolean;
	  }
	| { readonly kind: "apply" | "delete"; readonly oid: string };

/** Fresh HEAD identity prevents a form opened on one branch from mutating another. */
export type StashWriteRequest = StashRequest & {
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
};

/** Stash snapshots and guarded writes. Immutable OIDs identify selected saved work. */
export class RepositoryStashes {
	private constructor() {}

	static async read(
		root: string,
		signal: AbortSignal
	): Promise<GitResult<readonly StashInfo[]>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		return await opened.value.getStashes({ signal });
	}

	/** Performs only explicit writes, rechecking status and resolving mutable stash labels immediately before use. */
	static async write(
		root: string,
		request: StashWriteRequest
	): Promise<GitResult<void>> {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const repository = opened.value;
		const snapshot = await repository.getSnapshot();

		if (!snapshot.ok) return snapshot;

		const { head, files, operationState } = snapshot.value;

		const fail = (message: string): GitResult<void> => ({
			ok: false,
			error: {
				code: "conflict",
				operation: "stash",
				retryable: false,
				message,
			},
		});

		if (
			head.oid !== request.expectedHead ||
			head.branch !== request.expectedBranch
		)
			return fail(
				"The branch changed. Refresh before trying this stash action again."
			);

		if (
			operationState !== "normal" ||
			files.some((file) => file.recordType === "unmerged")
		)
			return fail(
				"Resolve conflicts and finish the current Git operation first."
			);

		if (request.kind === "create") {
			if (!head.oid)
				return fail("Create the first commit before stashing changes.");

			if (files.some((file) => file.submodule.startsWith("S")))
				return fail(
					"Stashing submodule changes is not supported here. Save them in the submodule first."
				);

			if (request.message.includes("\0"))
				return fail("The stash message contains an invalid character.");

			if (
				!files.some(
					(file) =>
						file.recordType !== "ignored" &&
						(request.includeUntracked || file.recordType !== "untracked")
				)
			)
				return fail("There are no changes to stash with these options.");

			const result = await repository.stash({
				message: request.message.trim() || undefined,
				includeUntracked: request.includeUntracked,
			});

			return result.ok ? { ok: true, value: undefined } : result;
		}

		const stashes = await repository.getStashes();

		if (!stashes.ok) return stashes;

		const matching = stashes.value.filter((stash) => stash.oid === request.oid);
		const stash = matching[0];

		if (!stash || matching.length !== 1)
			return fail(
				"This stash changed or is unavailable. Refresh and select it again."
			);

		if (
			request.kind === "apply" &&
			files.some((file) => file.recordType !== "ignored")
		)
			return fail(
				"Commit or stash current changes before applying saved work. Nothing was overwritten."
			);

		const result =
			request.kind === "apply"
				? await repository.applyStash({ reference: stash.oid })
				: await repository.dropStash({
						reference: stash.reference,
						expectedOid: stash.oid,
					});

		return result.ok ? { ok: true, value: undefined } : result;
	}

	/** Shows the saved tracked tree against its base, plus the optional parentless untracked snapshot. */
	static async readFiles(
		root: string,
		oid: string,
		signal: AbortSignal
	): Promise<GitResult<readonly WorkspaceEntry[]>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const repository = opened.value;
		const metadata = await repository.getCommit(oid, { signal });

		if (!metadata.ok) return metadata;

		const untracked = metadata.value.parentOids[2];
		const revisions = untracked ? [oid, untracked] : [oid];

		const results = await Promise.all(
			revisions.map(async (revision) => {
				const result = await repository.getCommitFiles(revision, { signal });

				if (!result.ok) return result;

				return {
					ok: true as const,
					value: result.value.map((file) => ({
						...RepositoryHistory.fileEntry(file, revision),
						id: `${revision}:${file.path}`,
						...(revision === untracked && {
							statusDescription: "Saved untracked file",
						}),
					})),
				};
			})
		);

		const files: WorkspaceEntry[] = [];

		for (const result of results) {
			if (!result.ok) return result;

			files.push(...result.value);
		}

		return { ok: true, value: files };
	}

	static entry(stash: StashInfo): WorkspaceRevision {
		const date = new Date(stash.createdAt);

		const formattedDate = Number.isNaN(date.valueOf())
			? stash.createdAt
			: stashDate.format(date);

		return {
			id: stash.oid,
			// Git includes the original branch in its summary (On/WIP on <branch>: ...).
			title: stash.summary || "Untitled stash",
			detail: `${stash.reference} · ${formattedDate}`,
			stash,
			files: [],
		};
	}
}

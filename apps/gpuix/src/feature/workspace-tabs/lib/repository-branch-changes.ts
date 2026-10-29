import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
	type GitResult,
	type RepositorySnapshot,
	type StashInfo,
} from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

const marker = /\[1git-branch-v1:([A-Za-z0-9_-]+)\]$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** A recoverable Git stash associated with one branch in one worktree. */
export interface SavedBranchChanges {
	readonly oid: string;
	readonly branch: string;
	readonly createdAt: string;
}

/** Stash metadata travels with the saved files, so recovery does not depend on app storage. */
export class RepositoryBranchChanges {
	private constructor() {}

	static list(
		root: string,
		stashes: readonly StashInfo[]
	): SavedBranchChanges[] {
		const saved: SavedBranchChanges[] = [];

		for (const stash of stashes) {
			const encoded = marker.exec(stash.summary)?.[1];

			if (!encoded || encoded.length > 16_384) continue;

			try {
				const metadata: unknown = JSON.parse(
					Buffer.from(encoded, "base64url").toString("utf8")
				);

				if (
					!metadata ||
					typeof metadata !== "object" ||
					!("id" in metadata) ||
					typeof metadata.id !== "string" ||
					!uuid.test(metadata.id) ||
					!("root" in metadata) ||
					metadata.root !== root ||
					!("branch" in metadata) ||
					typeof metadata.branch !== "string" ||
					!metadata.branch ||
					metadata.branch.length > 1024
				)
					continue;

				saved.push({
					oid: stash.oid,
					branch: metadata.branch,
					createdAt: stash.createdAt,
				});
			} catch {
				// An unrelated or malformed stash is never treated as app-managed work.
			}
		}

		return saved;
	}

	static async save(
		repository: GitRepository,
		root: string,
		branch: string
	): Promise<GitResult<SavedBranchChanges>> {
		const encoded = Buffer.from(
			JSON.stringify({ id: randomUUID(), root, branch })
		).toString("base64url");

		const message = `1git: changes for ${branch} [1git-branch-v1:${encoded}]`;
		const result = await repository.stash({ message, includeUntracked: true });
		const stashes = await repository.getStashes();

		const stash = stashes.ok
			? stashes.value.find((item) => item.summary.endsWith(message))
			: undefined;

		if (!result.ok)
			return {
				...result,
				error: {
					...result.error,
					message: `${result.error.message} Inspect Stashes before retrying; any saved backup has been kept.`,
				},
			};

		if (!stashes.ok) return stashes;

		if (!stash)
			return this.fail(
				"Could not identify the saved changes. Inspect Stashes before retrying."
			);

		return {
			ok: true,
			value: { oid: stash.oid, branch, createdAt: stash.createdAt },
		};
	}

	/** Apply by immutable OID; keep the backup on conflicts, failed reads, or cleanup failure. */
	static async restore(
		repository: GitRepository,
		root: string,
		branch: string,
		oid: string
	): Promise<GitResult<RepositorySnapshot>> {
		const stashes = await repository.getStashes();

		if (!stashes.ok) return stashes;

		const saved = this.list(root, stashes.value).find(
			(item) => item.oid === oid && item.branch === branch
		);

		const before = await repository.getSnapshot();

		if (!before.ok) return before;

		if (!saved)
			return this.fail(
				"These saved changes are unavailable. Refresh and select them again."
			);

		if (
			before.value.head.branch !== branch ||
			before.value.operationState !== "normal" ||
			before.value.files.some((file) => file.recordType !== "ignored")
		)
			return this.fail(
				"Restore requires a clean working tree on the saved branch. The backup is still in Stashes."
			);

		const applied = await repository.applyStash({
			reference: oid,
			reinstateIndex: true,
		});

		if (!applied.ok)
			return {
				...applied,
				error: {
					...applied.error,
					message: `${applied.error.message} Changes may be partially restored; review the files and resolve any conflicts. The recovery backup is still in Stashes.`,
				},
			};

		const after = await repository.getSnapshot();

		if (!after.ok) return after;

		if (
			after.value.head.oid !== before.value.head.oid ||
			after.value.head.branch !== branch ||
			after.value.operationState !== "normal" ||
			after.value.files.some((file) => file.recordType === "unmerged")
		)
			return this.fail(
				"The workspace changed during restoration. Review it before continuing; the recovery backup is still in Stashes."
			);

		// Stash labels move when another stash is added. Resolve only our immutable ID again.
		const current = await repository.getStashes();

		if (!current.ok) return current;

		const matching = current.value.filter((item) => item.oid === oid);
		const target = matching[0];

		if (!target || matching.length !== 1)
			return this.fail(
				"Changes restored, but backup cleanup could not be confirmed. Inspect Stashes."
			);

		const dropped = await repository.dropStash({
			reference: target.reference,
			expectedOid: target.oid,
		});

		if (!dropped.ok)
			return this.fail(
				"Changes restored, but the recovery backup could not be removed. It remains in Stashes."
			);

		return after;
	}

	static fail<T>(message: string): GitResult<T> {
		return {
			ok: false,
			error: {
				code: "conflict",
				operation: "checkout-branch",
				retryable: false,
				message,
			},
		};
	}
}

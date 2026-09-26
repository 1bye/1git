import { GitRepository, type GitResult, type StashInfo } from "@1git/git";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";
import { RepositoryHistory } from "./repository-history";

const stashDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Read-only stash snapshots. References are display labels; immutable OIDs identify all reads. */
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

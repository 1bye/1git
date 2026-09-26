import {
	GitRepository,
	type CommitInfo,
	type CommitPage,
	type GitResult,
} from "@1git/git";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";

const historyPageSize = 50;
const commitDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Bounded, read-only history queries anchored to the workspace's last refreshed HEAD. */
export class RepositoryHistory {
	private constructor() {}

	static async read(
		root: string,
		head: string,
		offset: number,
		signal: AbortSignal
	): Promise<GitResult<CommitPage>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		return await opened.value.getHistory({
			revision: head,
			offset,
			limit: historyPageSize,
			signal,
		});
	}

	static async readFiles(
		root: string,
		commit: string,
		signal: AbortSignal
	): Promise<GitResult<readonly WorkspaceEntry[]>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const result = await opened.value.getCommitFiles(commit, { signal });

		if (!result.ok) return result;

		return {
			ok: true,
			value: result.value.map((file) => ({
				id: file.path,
				title: file.path,
				status: file.status,
				statusDescription: file.originalPath
					? `renamed from ${file.originalPath}`
					: undefined,
				commitFile: { ...file, commit },
			})),
		};
	}

	static entry(commit: CommitInfo): WorkspaceRevision {
		const date = new Date(commit.authoredAt);

		const formattedDate = Number.isNaN(date.valueOf())
			? commit.authoredAt
			: commitDate.format(date);

		return {
			id: commit.oid,
			title: commit.summary || "Untitled commit",
			detail: `${commit.author.name} · ${formattedDate} · ${commit.oid.slice(0, 7)}`,
			commit,
			files: [],
		};
	}
}

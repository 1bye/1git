import {
	GitRepository,
	type CommitFileChange,
	type CommitInfo,
	type CommitPage,
	type GitResult,
} from "@1git/git";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";

const historyPageSize = 50;
const historySearchBatchSize = 250;
const commitDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Bounded, read-only history queries anchored to the workspace's last refreshed HEAD. */
export class RepositoryHistory {
	private constructor() {}

	static async read(
		root: string,
		head: string,
		offset: number,
		signal: AbortSignal,
		query = ""
	): Promise<GitResult<CommitPage>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const needle = query.trim().toLowerCase();

		if (needle) {
			const commits: CommitInfo[] = [];
			let cursor = offset;
			let nextOffset = offset;

			// Scan bounded batches rather than retaining the repository's entire history.
			while (true) {
				signal.throwIfAborted();
				const page = await opened.value.getHistory({
					revision: head,
					offset: cursor,
					limit: historySearchBatchSize,
					signal,
				});

				if (!page.ok) return page;

				for (const commit of page.value.commits) {
					cursor += 1;

					if (RepositoryHistory.matches(commit, needle)) commits.push(commit);

					if (commits.length === historyPageSize) nextOffset = cursor;

					if (commits.length > historyPageSize)
						return {
							ok: true,
							value: {
								commits: commits.slice(0, historyPageSize),
								hasMore: true,
								nextOffset,
							},
						};
				}

				if (!page.value.hasMore)
					return {
						ok: true,
						value: { commits, hasMore: false, nextOffset: null },
					};
			}
		}

		return await opened.value.getHistory({
			revision: head,
			offset,
			limit: historyPageSize,
			signal,
		});
	}

	/** Literal, case-insensitive matching across full message, author identity and commit ID. */
	static matches(commit: CommitInfo, query: string): boolean {
		const needle = query.trim().toLowerCase();

		return [
			commit.oid,
			commit.summary,
			commit.body,
			commit.author.name,
			commit.author.email,
		].some((value) => value?.toLowerCase().includes(needle));
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
			value: result.value.map((file) =>
				RepositoryHistory.fileEntry(file, commit)
			),
		};
	}

	/** Immutable file comparison shared by commits and saved stash snapshots. */
	static fileEntry(file: CommitFileChange, commit: string): WorkspaceEntry {
		return {
			id: file.path,
			title: file.path,
			status: file.status,
			statusDescription: file.originalPath
				? `renamed from ${file.originalPath}`
				: undefined,
			commitFile: { ...file, commit },
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

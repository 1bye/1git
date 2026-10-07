import {
	GitRepository,
	type CommitFileChange,
	type CommitInfo,
	type CommitPage,
	type GitResult,
	type RevertCommitInput,
	type CherryPickCommitInput,
} from "@1git/git";
import type { HostingProvider } from "@1git/hosting/provider";
import { parseRemote } from "@1git/hosting/remote";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";

const historyPageSize = 50;
const historySearchBatchSize = 250;
const commitDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const commitObjectId = /^(?:[a-f\d]{40}|[a-f\d]{64})$/iu;

/** Browser destination derived from a supported configured remote, not proof that a commit is published. */
export interface CommitWebLink {
	readonly label: "View on GitHub" | "View on GitLab";
	readonly url: string;
}

/** Bounded history queries and non-rewriting commit actions anchored to the workspace's reviewed HEAD. */
export class RepositoryHistory {
	private constructor() {}

	/** Reads only local metadata: prefer the branch upstream, then origin, then a sole remote. Never guesses among other remotes. */
	static async readCommitLink(
		root: string,
		oid: string,
		signal: AbortSignal,
		providers: readonly HostingProvider[] = []
	): Promise<CommitWebLink | null> {
		if (!commitObjectId.test(oid)) return null;

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return null;

		const [remotes, branches] = await Promise.all([
			opened.value.getRemotes({ signal }),
			opened.value.getBranches({ signal }),
		]);

		if (!remotes.ok || !branches.ok) return null;

		const upstream = branches.value.branches.find(
			(branch) => branch.type === "local" && branch.checkedOut
		)?.upstreamRemote;

		const remote = upstream
			? remotes.value.find((item) => item.name === upstream)
			: (remotes.value.find((item) => item.name === "origin") ??
				(remotes.value.length === 1 ? remotes.value[0] : undefined));

		const url = remote?.fetchUrls[0] ?? remote?.pushUrls[0];

		if (!url) return null;

		const parsed = parseRemote(url, providers);

		if (!parsed.ok) return null;

		const { providerId, browserUrl } = parsed.value;

		if (providerId !== "github" && providerId !== "gitlab") return null;

		return {
			label: providerId === "github" ? "View on GitHub" : "View on GitLab",
			url: `${browserUrl}/${providerId === "github" ? "commit" : "-/commit"}/${oid}`,
		};
	}

	/** Adds a reversing commit; the backend validates a clean tree and the reviewed branch under its write lock. */
	static async revert(root: string, request: RevertCommitInput) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.revertCommit(request);
	}

	/** Switches to the reviewed destination and replays one exact commit without rewriting the source. */
	static async cherryPick(root: string, request: CherryPickCommitInput) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.cherryPickCommit(request);
	}

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

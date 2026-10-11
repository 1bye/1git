import {
	GitRepository,
	type CommitFileChange,
	type CommitInfo,
	type CommitPage,
	type GitResult,
	type RevertCommitInput,
	type CherryPickCommitInput,
	type ResetCommitInput,
	type ReorderCommitsInput,
} from "@1git/git";
import type { HostingProvider } from "@1git/hosting/provider";
import { parseRemote } from "@1git/hosting/remote";

import type { WorkspaceEntry, WorkspaceRevision } from "../types";

const historyPageSize = 50;
const historySearchBatchSize = 250;
const resetTimeoutMs = 30_000;
const reorderTimeoutMs = 120_000;
const commitDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const commitObjectId = /^(?:[a-f\d]{40}|[a-f\d]{64})$/iu;

/** A literal file path, optionally anchored to a saved commit or stash rather than HEAD. */
export interface FileHistoryScope {
	readonly path: string;
	readonly revision?: string;
}

/** Browser destination derived from a supported configured remote, not proof that a commit is published. */
export interface CommitWebLink {
	readonly label: "View on GitHub" | "View on GitLab";
	readonly url: string;
}

/** Bounded history queries and explicitly reviewed commit actions anchored to one workspace branch. */
export class RepositoryHistory {
	private constructor() {}

	/** Reviews a local unpublished range without fetching or changing refs. */
	static async readReorder(root: string, input: ReorderCommitsInput) {
		const opened = await GitRepository.open({
			path: root,
			signal: input.signal,
		});

		return opened.ok ? await opened.value.getReorderPlan(input) : opened;
	}

	/** Explicit isolated replay with unchanged files and retained original history; never retries automatically. */
	static async reorder(root: string, input: ReorderCommitsInput) {
		const timeout = AbortSignal.timeout(reorderTimeoutMs);

		const signal = input.signal
			? AbortSignal.any([input.signal, timeout])
			: timeout;

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const result = await opened.value.reorderCommits({ ...input, signal });

		return !result.ok && result.error.code === "aborted"
			? {
					ok: false as const,
					error: {
						...result.error,
						retryable: false,
						message:
							"Reorder stopped. Refresh and inspect History before retrying; the outcome may have completed.",
					},
				}
			: result;
	}

	/** Reviews a local-only reset without changing the branch or contacting a remote. */
	static async readReset(root: string, input: ResetCommitInput) {
		const opened = await GitRepository.open({
			path: root,
			signal: input.signal,
		});

		return opened.ok ? await opened.value.getResetCommitPlan(input) : opened;
	}

	/** Moves only the reviewed branch; the backend preserves files/index and retains original history. */
	static async reset(root: string, input: ResetCommitInput) {
		const signal = input.signal
			? AbortSignal.any([input.signal, AbortSignal.timeout(resetTimeoutMs)])
			: AbortSignal.timeout(resetTimeoutMs);

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const result = await opened.value.resetToCommit({ ...input, signal });

		return !result.ok && result.error.code === "aborted"
			? {
					ok: false as const,
					error: {
						...result.error,
						retryable: false,
						message:
							"Reset stopped. Refresh and inspect History before retrying; the outcome may have completed.",
					},
				}
			: result;
	}

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
		query = "",
		file?: FileHistoryScope
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
					revision: file?.revision ?? head,
					filePath: file?.path,
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
			revision: file?.revision ?? head,
			filePath: file?.path,
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
			files: commit.historyFile
				? [RepositoryHistory.fileEntry(commit.historyFile, commit.oid)]
				: [],
			filesLoaded: commit.historyFile ? true : undefined,
		};
	}

	/** Git's %B contains the subject paragraph too; show only the description beneath the title. */
	static description(commit: CommitInfo): string {
		const message = commit.body.replace(/\r\n/gu, "\n");
		const separator = message.search(/\n[\t ]*\n/u);

		return separator < 0 ? "" : message.slice(separator).trim();
	}
}

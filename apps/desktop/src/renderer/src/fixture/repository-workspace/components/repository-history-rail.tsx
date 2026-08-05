import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	ResetMode,
} from "@1git/git";
import { Input } from "@1git/ui/components/input";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import type { ChangeEvent, ReactElement, UIEvent } from "react";
import { useMemo, useState } from "react";
import { RepositoryHistoryContextMenu } from "@/fixture/repository-workspace/components/repository-history-context-menu.js";

const INITIAL_HISTORY_COMMIT_COUNT = 24;
const HISTORY_COMMIT_BATCH_SIZE = 24;
const HISTORY_LOAD_AHEAD_PX = 160;

interface RepositoryHistoryRailProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string | null;
	readonly headOid: string | null;
	readonly history: CommitPage | null;
	readonly isPending: boolean;
	readonly onAmendCommit: (
		commit: CommitInfo,
		summary: string,
		description: string
	) => Promise<boolean>;
	readonly onCherryPickCommit: (
		commit: CommitInfo,
		branchName: string
	) => Promise<boolean>;
	readonly onResetCommit: (
		commit: CommitInfo,
		mode: ResetMode
	) => Promise<boolean>;
	readonly onRevertCommit: (commit: CommitInfo) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly selectedCommitOid: string | null;
}

interface RepositoryHistoryListProps
	extends Omit<RepositoryHistoryRailProps, "history"> {
	readonly commits: readonly CommitInfo[];
}

function RepositoryHistoryList({
	branches,
	commits,
	currentBranch,
	headOid,
	isPending,
	onAmendCommit,
	onCherryPickCommit,
	onResetCommit,
	onRevertCommit,
	onSelectCommit,
	selectedCommitOid,
}: RepositoryHistoryListProps): ReactElement {
	const [visibleCommitCount, setVisibleCommitCount] = useState(
		INITIAL_HISTORY_COMMIT_COUNT
	);
	const loadMoreCommits = (event: UIEvent<HTMLUListElement>): void => {
		const list = event.currentTarget;
		const remainingScroll =
			list.scrollHeight - list.scrollTop - list.clientHeight;
		if (
			remainingScroll > HISTORY_LOAD_AHEAD_PX ||
			visibleCommitCount >= commits.length
		) {
			return;
		}
		setVisibleCommitCount((currentCount) =>
			Math.min(commits.length, currentCount + HISTORY_COMMIT_BATCH_SIZE)
		);
	};

	return (
		<ul
			className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
			onScroll={loadMoreCommits}
		>
			{commits.slice(0, visibleCommitCount).map((commit) => (
				<li key={commit.oid}>
					<RepositoryHistoryContextMenu
						branches={branches}
						commit={commit}
						currentBranch={currentBranch}
						headOid={headOid}
						isPending={isPending}
						isSelected={selectedCommitOid === commit.oid}
						onAmend={onAmendCommit}
						onCherryPick={onCherryPickCommit}
						onReset={onResetCommit}
						onRevert={onRevertCommit}
						onSelect={onSelectCommit}
					/>
				</li>
			))}
		</ul>
	);
}

export function RepositoryHistoryRail({
	branches,
	currentBranch,
	headOid,
	history,
	isPending,
	onAmendCommit,
	onCherryPickCommit,
	onResetCommit,
	onRevertCommit,
	onSelectCommit,
	selectedCommitOid,
}: RepositoryHistoryRailProps): ReactElement {
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const commits = useMemo(() => {
		const allCommits = history?.commits ?? [];
		if (!normalizedQuery) {
			return allCommits;
		}
		return allCommits.filter(
			(commit) =>
				commit.summary.toLocaleLowerCase().includes(normalizedQuery) ||
				commit.author.name.toLocaleLowerCase().includes(normalizedQuery) ||
				commit.oid.toLocaleLowerCase().startsWith(normalizedQuery)
		);
	}, [history?.commits, normalizedQuery]);
	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		setQuery(event.target.value);
	};
	let emptyMessage = "Loading commit history…";
	if (history) {
		emptyMessage = query
			? `No commits match “${query}”.`
			: "This repository has no commits yet.";
	}

	return (
		<aside
			aria-label="Commit history"
			className="flex min-h-0 flex-1 flex-col bg-editor-surface"
			data-name="RepositoryHistoryRail"
		>
			<div className="shrink-0 px-2 py-1">
				<div className="relative">
					<FunnelSimpleIcon
						aria-hidden
						className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
						weight="duotone"
					/>
					<Input
						aria-label="Filter commit history"
						className="h-8 bg-editor-sunken pl-8 text-xss shadow-none"
						onChange={updateQuery}
						placeholder="Filter commits"
						type="search"
						value={query}
					/>
				</div>
			</div>
			{history && commits.length > 0 ? (
				<RepositoryHistoryList
					branches={branches}
					commits={commits}
					currentBranch={currentBranch}
					headOid={headOid}
					isPending={isPending}
					key={`${normalizedQuery}:${commits[0]?.oid ?? ""}:${commits.length}`}
					onAmendCommit={onAmendCommit}
					onCherryPickCommit={onCherryPickCommit}
					onResetCommit={onResetCommit}
					onRevertCommit={onRevertCommit}
					onSelectCommit={onSelectCommit}
					selectedCommitOid={selectedCommitOid}
				/>
			) : (
				<p className="min-h-0 flex-1 px-4 py-10 text-center text-editor-faint text-xss">
					{emptyMessage}
				</p>
			)}
		</aside>
	);
}

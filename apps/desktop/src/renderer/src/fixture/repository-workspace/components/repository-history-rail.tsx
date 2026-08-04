import type { CommitInfo, CommitPage } from "@1git/git";
import { Input } from "@1git/ui/components/input";
import { cn } from "@1git/ui/lib/utils";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import type { ChangeEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { formatRelativeTime } from "@/feature/workspace/lib/workspace-model.js";

interface RepositoryCommitRowProps {
	readonly commit: CommitInfo;
	readonly isSelected: boolean;
	readonly onSelect: (commit: CommitInfo) => Promise<void>;
}

function RepositoryCommitRow({
	commit,
	isSelected,
	onSelect,
}: RepositoryCommitRowProps): ReactElement {
	const selectCommit = async (): Promise<void> => {
		await onSelect(commit);
	};

	return (
		<li>
			<button
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex w-full gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-editor-muted/20",
					isSelected ? "bg-editor-sunken-2" : "hover:bg-editor-sunken"
				)}
				onClick={selectCommit}
				type="button"
			>
				<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-editor-sunken text-editor-muted">
					<GitCommitIcon aria-hidden className="size-3.5" weight="duotone" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-editor-ink text-xss">
						{commit.summary}
					</span>
					<span className="mt-1 flex items-center gap-2 text-[9px] text-editor-faint">
						<span className="min-w-0 flex-1 truncate">
							{commit.author.name}
						</span>
						<span className="shrink-0 tabular-nums">
							{formatRelativeTime(commit.committedAt)}
						</span>
					</span>
				</span>
			</button>
		</li>
	);
}

interface RepositoryHistoryRailProps {
	readonly history: CommitPage | null;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly selectedCommitOid: string | null;
}

export function RepositoryHistoryRail({
	history,
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
			<ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1 pb-1">
				{commits.map((commit) => (
					<RepositoryCommitRow
						commit={commit}
						isSelected={selectedCommitOid === commit.oid}
						key={commit.oid}
						onSelect={onSelectCommit}
					/>
				))}
				{history && commits.length === 0 ? (
					<li className="px-4 py-10 text-center text-editor-faint text-xss">
						{query
							? `No commits match “${query}”.`
							: "This repository has no commits yet."}
					</li>
				) : null}
				{history ? null : (
					<li className="px-4 py-10 text-center text-editor-faint text-xss">
						Loading commit history…
					</li>
				)}
			</ul>
		</aside>
	);
}

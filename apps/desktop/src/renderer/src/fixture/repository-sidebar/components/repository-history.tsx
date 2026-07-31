import type { CommitInfo, CommitPage } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import type { ReactElement } from "react";
import { formatRelativeTime } from "../../../feature/workspace/lib/workspace-model.js";

interface CommitRowProps {
	readonly commit: CommitInfo;
	readonly isSelected: boolean;
	readonly onSelect: (commit: CommitInfo) => Promise<void>;
}

function CommitRow({
	commit,
	isSelected,
	onSelect,
}: CommitRowProps): ReactElement {
	const selectCommit = async (): Promise<void> => {
		await onSelect(commit);
	};

	return (
		<li data-name="CommitRow">
			<button
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex w-full gap-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
					isSelected
						? "bg-studio-glass-strong shadow-[inset_2px_0_0_var(--brand)]"
						: "hover:bg-hover"
				)}
				onClick={selectCommit}
				type="button"
			>
				<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-studio-glass-strong text-editor-muted shadow-surface-1">
					<GitCommitIcon aria-hidden className="size-3.5" weight="regular" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-editor-ink text-xss">
						{commit.summary}
					</span>
					<span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-editor-faint">
						<span className="truncate">{commit.author.name}</span>
						<span className="shrink-0">
							{formatRelativeTime(commit.committedAt)}
						</span>
					</span>
				</span>
			</button>
		</li>
	);
}

interface RepositoryHistoryProps {
	readonly history: CommitPage | null;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly selectedCommitOid: string | null;
}

export function RepositoryHistory({
	history,
	onSelectCommit,
	selectedCommitOid,
}: RepositoryHistoryProps): ReactElement {
	if (!history) {
		return (
			<p
				className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center text-editor-faint text-xss"
				role="status"
			>
				Loading commit history…
			</p>
		);
	}

	return (
		<ul
			aria-label="Commit history"
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
			data-name="RepositoryHistory"
		>
			{history.commits.map((commit) => (
				<CommitRow
					commit={commit}
					isSelected={selectedCommitOid === commit.oid}
					key={commit.oid}
					onSelect={onSelectCommit}
				/>
			))}
			{history.commits.length === 0 ? (
				<li className="px-4 py-10 text-center text-editor-faint text-xss">
					This repository has no commits yet.
				</li>
			) : null}
		</ul>
	);
}

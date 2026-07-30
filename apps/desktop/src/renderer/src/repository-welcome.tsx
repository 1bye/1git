import { Button } from "@1git/ui/components/button";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import type { RecentRepositoryRecord } from "../../shared/repository-session.js";
import { formatRelativeTime, recentRepositoryName } from "./workspace-model.js";

interface RepositoryWelcomeProps {
	readonly isLoading: boolean;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
}

export const RepositoryWelcome = ({
	isLoading,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
}: RepositoryWelcomeProps): ReactElement => {
	const pickRepository = async (): Promise<void> => {
		await onPickRepository();
	};

	return (
		<main
			className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-editor-surface px-8 py-12"
			data-name="RepositoryWelcome"
		>
			<div className="w-full max-w-[620px]">
				<div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-editor-ink text-white shadow-surface-3">
					{isLoading ? (
						<SpinnerGapIcon
							aria-hidden
							className="size-5 animate-spin"
							weight="bold"
						/>
					) : (
						<GitBranchIcon aria-hidden className="size-5" weight="bold" />
					)}
				</div>
				<h1 className="mt-5 text-center font-semibold text-editor-ink text-xl tracking-[-0.03em]">
					Open a repository
				</h1>
				<p className="mx-auto mt-2 max-w-[420px] text-center text-editor-muted text-xs leading-5">
					Review changes, shape commits, and move through history without
					leaving your local workspace.
				</p>
				<div className="mt-6 flex justify-center">
					<Button
						disabled={isLoading}
						onClick={pickRepository}
						size="sm"
						variant="brand"
					>
						<FolderOpenIcon aria-hidden className="size-4" weight="bold" />
						Open local repository
					</Button>
				</div>

				{recentRepositories.length > 0 ? (
					<section
						aria-labelledby="welcome-recent-heading"
						className="mt-10"
						data-name="RecentRepositories"
					>
						<h2
							className="mb-2 px-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							id="welcome-recent-heading"
						>
							Recent repositories
						</h2>
						<div className="overflow-hidden rounded-2xl border border-editor-hairline bg-editor-sunken/60">
							{recentRepositories.slice(0, 5).map((repository) => {
								const openRecent = async (): Promise<void> => {
									await onOpenRecent(repository.path);
								};
								return (
									<button
										className="group flex w-full items-center gap-3 border-editor-hairline border-b px-3.5 py-3 text-left outline-none last:border-b-0 hover:bg-editor-surface focus-visible:bg-editor-surface"
										key={repository.path}
										onClick={openRecent}
										type="button"
									>
										<span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-editor-muted shadow-surface-1">
											<FolderOpenIcon
												aria-hidden
												className="size-4"
												weight="regular"
											/>
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium text-editor-ink text-xs">
												{recentRepositoryName(repository)}
											</span>
											<span className="block truncate text-[10px] text-editor-faint">
												{repository.path}
											</span>
										</span>
										<span className="shrink-0 text-[10px] text-editor-faint">
											{formatRelativeTime(repository.lastOpenedAt)}
										</span>
									</button>
								);
							})}
						</div>
					</section>
				) : null}
			</div>
		</main>
	);
};

import type { RepositorySnapshot } from "@1git/git";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import type { ReactElement } from "react";

interface CleanStateProps {
	readonly onFetch: () => Promise<void>;
	readonly snapshot: RepositorySnapshot;
}

export const CleanState = ({
	onFetch,
	snapshot,
}: CleanStateProps): ReactElement => {
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};

	return (
		<section
			className="flex min-h-full items-center justify-center px-10 py-16"
			data-name="CleanState"
		>
			<div className="w-full max-w-[560px] text-center">
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10">
					<CheckCircleIcon aria-hidden className="size-6" weight="fill" />
				</div>
				<h1 className="mt-5 font-semibold text-[24px] text-editor-ink tracking-[-0.03em]">
					Working tree is clean
				</h1>
				<p className="mx-auto mt-2 max-w-[430px] text-[13px] text-editor-muted leading-5">
					There are no local changes on{" "}
					<span className="font-medium text-editor-ink">
						{snapshot.head.branch ?? "the current branch"}
					</span>
					. You’re ready for the next change.
				</p>
				<div className="mt-7 grid grid-cols-2 overflow-hidden rounded-2xl border border-editor-hairline bg-editor-sunken/55 text-left">
					<div className="border-editor-hairline border-r p-4">
						<GitBranchIcon
							aria-hidden
							className="size-4 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[12px] text-editor-ink">
							{snapshot.head.branch ?? "Detached HEAD"}
						</p>
						<p className="mt-1 text-[10px] text-editor-faint">
							{snapshot.head.upstream ?? "No upstream configured"}
						</p>
					</div>
					<button
						className="p-4 text-left outline-none hover:bg-white/70 focus-visible:bg-white"
						onClick={fetchRepository}
						type="button"
					>
						<ArrowsClockwiseIcon
							aria-hidden
							className="size-4 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[12px] text-editor-ink">
							Fetch remote
						</p>
						<p className="mt-1 text-[10px] text-editor-faint">
							Check for new commits
						</p>
					</button>
				</div>
			</div>
		</section>
	);
};

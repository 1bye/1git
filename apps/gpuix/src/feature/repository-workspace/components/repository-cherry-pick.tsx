import { radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { Text } from "@1git/gpuix-ui/text";
import type { BranchInfo, CherryPickCommitInput, CommitInfo } from "@1git/git";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";
import { appTokens } from "../../../styles/tokens";
import {
	RepositoryBranches,
	type WorkspaceBranches,
} from "../../workspace-tabs/lib/repository-branches";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import { RepositoryList } from "./repository-list";

/** Source identity captured when the user chose the historical commit, independent of later selection. */
export interface CherryPickReview {
	readonly root: string;
	readonly commit: CommitInfo;
	readonly expectedHead: string;
	readonly expectedBranch: string;
}

/** Chooses an unoccupied local destination; the window owns switching, replay and conflict recovery. */
export function RepositoryCherryPick({
	state,
	review,
	readBranches = RepositoryBranches.read,
	onWrite,
	onCancel,
	onFinished,
}: {
	state: RepositoryWorkspaceState;
	review: CherryPickReview;
	readBranches?: typeof RepositoryBranches.read;
	onWrite: (input: CherryPickCommitInput) => Promise<string | null>;
	onCancel: () => void;
	onFinished: () => void;
}) {
	const renderer = useGpuixRequired();
	const list = useRef<PublicInstance>(null);
	const submitting = useRef(false);
	const [data, setData] = useState<WorkspaceBranches | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<BranchInfo | null>(null);
	const [scrollY, setScrollY] = useState(0);

	useEffect(() => {
		const controller = new AbortController();

		const read = async (): Promise<void> => {
			try {
				const result = await readBranches(review.root, controller.signal);

				if (controller.signal.aborted) return;

				if (result.ok) setData(result.value);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError("Could not load branches. Cancel and try again.");
			}
		};

		void read();

		return () => controller.abort();
	}, [readBranches, review.root]);

	const repository = state.repository;
	const busy = pending || RepositoryWorkspaceModel.isBusy(state);

	const changed =
		repository?.root !== review.root ||
		repository.head !== review.expectedHead ||
		repository.branchName !== review.expectedBranch;

	const blocked =
		state.preview ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		repository?.operation !== "normal" ||
		state.entries.changes.length > 0;

	const needle = query.trim().toLowerCase();

	const branches = (data?.branches.branches ?? []).filter(
		(branch) =>
			branch.type === "local" &&
			branch.name !== review.expectedBranch &&
			!branch.checkedOut &&
			!branch.worktreePath &&
			!data?.worktrees.some(
				(worktree) => worktree.branch === branch.fullName
			) &&
			branch.name.toLowerCase().includes(needle)
	);

	const target = branches.find(
		(branch) =>
			branch.fullName === selected?.fullName && branch.oid === selected.oid
	);

	const disabled = !target || !data || busy || blocked || changed;

	const submit = async (): Promise<void> => {
		if (disabled || !target || submitting.current) return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			await onWrite({
				commit: review.commit.oid,
				expectedHead: review.expectedHead,
				expectedBranch: review.expectedBranch,
				targetBranch: target.name,
				expectedTarget: target.oid,
			});
			// Show the window-owned result and any paused-operation controls in Changes.
			onFinished();
		} catch {
			setError(
				"Could not confirm the cherry-pick. Refresh and inspect Changes before retrying."
			);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	};

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<PopoverContent
				tokens={appTokens}
				placement="center"
				width={420}
				dismissible={!busy}
				aria-label="Cherry-pick commit"
				testId="cherry-pick-dialog"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text tokens={appTokens} size="lg">
						Cherry-pick commit
					</Text>
					<Text tokens={appTokens} testId="cherry-pick-commit">
						{review.commit.summary}
					</Text>
					<Text
						tokens={appTokens}
						size="xs"
						tone="muted"
					>{`${review.commit.oid.slice(0, 7)} · ${review.expectedBranch}`}</Text>
					<input
						autoFocus
						testId="cherry-pick-search"
						aria-label="Search destination branches"
						placeholder="Search branches…"
						value={query}
						readOnly={busy}
						onChange={(event) => {
							setQuery(event.value ?? "");
							setSelected(null);
							setScrollY(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "down" && !busy && list.current)
								renderer.focusNextWithin?.(list.current.id);
						}}
						style={{
							...typography.md,
							width: "100%",
							height: 30,
							flexShrink: 0,
							paddingLeft: spacing[2.5],
							paddingRight: spacing[2.5],
							borderRadius: radius.md,
							borderWidth: 1,
							borderColor: appTokens.colors.border,
							backgroundColor: appTokens.colors.field,
						}}
					/>
					<div
						ref={list}
						onKeyDown={(event) => {
							if (event.key === "enter") void submit();
						}}
						style={{ height: 180, minHeight: 0 }}
					>
						<RepositoryList
							key={query}
							testId="cherry-pick-branches"
							label="Destination branches"
							emptyMessage={
								error
									? "Branches unavailable"
									: data
										? "No available matching local branches"
										: "Loading branches…"
							}
							entries={branches.map((branch) => ({
								id: `cherry-pick-${branch.fullName}`,
								title: branch.name,
							}))}
							state={{
								selectedId: target ? `cherry-pick-${target.fullName}` : null,
								scrollY,
							}}
							onScroll={setScrollY}
							onSelect={(id) => {
								if (!busy)
									setSelected(
										branches.find(
											(branch) => `cherry-pick-${branch.fullName}` === id
										) ?? null
									);
							}}
						/>
					</div>
					<Text
						tokens={appTokens}
						size="sm"
						tone="muted"
						testId="cherry-pick-summary"
					>
						{target
							? `Switch to ${target.name} and copy this commit. ${review.expectedBranch} stays unchanged.`
							: "Choose a local destination branch. Branches open in other worktrees are excluded."}
					</Text>
					{error || changed || (!pending && blocked) ? (
						<text
							role="alert"
							testId="cherry-pick-error"
							style={{ ...typography.xs, color: appTokens.colors.danger }}
						>
							{error ??
								(changed
									? "The branch changed. Cancel and review History again."
									: "Commit or stash your changes and finish the current operation first.")}
						</text>
					) : null}
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: spacing[2],
						}}
					>
						<Button
							tokens={appTokens}
							variant="secondary"
							testId="cherry-pick-cancel"
							disabled={busy}
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							tokens={appTokens}
							testId="cherry-pick-confirm"
							disabled={disabled}
							onPress={() => {
								void submit();
							}}
						>
							{pending ? "Cherry-picking…" : "Cherry-pick commit"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

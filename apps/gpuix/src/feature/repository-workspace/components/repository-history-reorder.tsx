import { useAppTheme } from "../../../styles/theme";
import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type { CommitInfo, ReorderCommitsInput, ReorderPlan } from "@1git/git";
import { useEffect, useRef, useState } from "react";
import { RepositoryHistory } from "../lib/repository-history";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
	type RepositoryListState,
} from "../lib/repository-workspace-model";
import { RepositoryList } from "./repository-list";

const reviewTimeoutMs = 10_000;
const revisionRowHeight = 48;
const maxListHeight = 240;

/** Captured original range and branch identity; dialog selection never changes the reviewed range. */
export interface HistoryReorderReview {
	readonly root: string;
	readonly commits: readonly CommitInfo[];
	readonly input: ReorderCommitsInput;
}

/** Oldest-first ordering with native list navigation and explicit, guarded confirmation. */
export function RepositoryHistoryReorder({
	state,
	review,
	read = RepositoryHistory.readReorder,
	onWrite,
	onCancel,
	onFinished,
}: {
	state: RepositoryWorkspaceState;
	review: HistoryReorderReview;
	read?: typeof RepositoryHistory.readReorder;
	onWrite: (input: ReorderCommitsInput) => Promise<string | null>;
	onCancel: () => void;
	onFinished: () => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [order, setOrder] = useState<readonly CommitInfo[]>(
		[...review.commits].reverse()
	);

	const [list, setList] = useState<RepositoryListState>({
		selectedId: order[0]?.oid ?? null,
		scrollY: 0,
	});

	const [plan, setPlan] = useState<ReorderPlan | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const submitting = useRef(false);
	const busy = pending || RepositoryWorkspaceModel.isBusy(state);

	const changed =
		state.repository?.root !== review.root ||
		state.repository.head !== review.input.expectedHead ||
		state.repository.branchName !== review.input.expectedBranch;

	const unavailable =
		changed ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		state.repository?.operation !== "normal" ||
		state.entries.changes.length > 0;

	const reordered = order.some(
		(commit, index) => commit.oid !== review.input.order[index]
	);

	const selectedIndex = order.findIndex(
		(commit) => commit.oid === list.selectedId
	);

	const rootFirst = order[0]?.parentOids.length === 0;

	const canMove = (step: number): boolean =>
		!busy &&
		!unavailable &&
		!!plan &&
		selectedIndex >= 0 &&
		selectedIndex + step >= (rootFirst ? 1 : 0) &&
		selectedIndex + step < order.length &&
		!(rootFirst && selectedIndex === 0);

	useEffect(() => {
		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await read(review.root, {
					...review.input,
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(reviewTimeoutMs),
					]),
				});

				if (controller.signal.aborted) return;

				if (result.ok) setPlan(result.value);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError(
						"Could not review these commits. Cancel and refresh History."
					);
			}
		};

		void load();

		return () => controller.abort();
	}, [read, review]);

	const move = (step: number): void => {
		if (!canMove(step)) return;

		const next = [...order];
		const current = next[selectedIndex];
		const destination = next[selectedIndex + step];

		if (!current || !destination) return;

		next[selectedIndex] = destination;
		next[selectedIndex + step] = current;
		setOrder(next);
	};

	const submit = async (): Promise<void> => {
		if (busy || unavailable || !plan || !reordered || submitting.current)
			return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const failure = await onWrite({
				...review.input,
				order: order.map((commit) => commit.oid),
			});

			if (failure) {
				setError(failure);
				setPlan(null);
			} else onFinished();
		} catch {
			setError(
				"Could not confirm the reorder. Refresh and inspect History before retrying."
			);
			setPlan(null);
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
				width={440}
				dismissible={!busy}
				aria-label="Reorder commits"
				testId="reorder-dialog"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text
						tokens={appTokens}
						size="lg"
					>{`Reorder ${review.commits.length} commits`}</Text>
					<Text tokens={appTokens} size="sm" tone="muted">
						Oldest first · Select a commit to move
					</Text>
					<div
						style={{
							height: Math.min(
								maxListHeight,
								order.length * revisionRowHeight + spacing[1.5]
							),
							minHeight: 0,
						}}
					>
						<RepositoryList
							entries={order.map((commit) => ({
								id: commit.oid,
								title: commit.summary,
								detail: `${commit.oid.slice(0, 7)} · ${commit.author.name}${commit.parentOids.length === 0 ? " · Root commit" : ""}`,
							}))}
							label="Commit replay order, oldest first"
							testId="reorder-list"
							emptyMessage="No commits selected."
							state={list}
							onSelect={(selectedId) => {
								if (!busy) setList((current) => ({ ...current, selectedId }));
							}}
							onScroll={(scrollY) =>
								setList((current) => ({ ...current, scrollY }))
							}
						/>
					</div>
					<div
						style={{ display: "flex", flexDirection: "row", gap: spacing[1] }}
					>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="reorder-earlier"
							disabled={!canMove(-1)}
							onPress={() => move(-1)}
						>
							Move earlier
						</Button>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="reorder-later"
							disabled={!canMove(1)}
							onPress={() => move(1)}
						>
							Move later
						</Button>
					</div>
					{plan ? (
						<Text
							tokens={appTokens}
							size="sm"
							tone="muted"
							testId="reorder-replay"
						>
							{plan.replay.length
								? `${plan.replay.length} later ${plan.replay.length === 1 ? "commit will" : "commits will"} also be replayed. Files stay unchanged.`
								: "Commit IDs may change. Files stay unchanged."}
						</Text>
					) : !error ? (
						<Text tokens={appTokens} size="sm" tone="muted">
							Reviewing commits…
						</Text>
					) : null}
					<Text tokens={appTokens} size="xs" tone="muted">
						Only unpublished history. Fetch first if another tool may have
						pushed. Original history is retained; tags and other branches stay
						unchanged.
					</Text>
					{error || unavailable ? (
						<Text
							tokens={appTokens}
							tone="danger"
							role="alert"
							testId="reorder-error"
						>
							{unavailable
								? "The repository changed or is unavailable. Cancel and review again."
								: error}
						</Text>
					) : null}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: spacing[1],
						}}
					>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="reorder-cancel"
							disabled={busy}
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							tokens={appTokens}
							size="sm"
							testId="reorder-confirm"
							disabled={busy || unavailable || !plan || !reordered}
							onPress={() => {
								void submit();
							}}
						>
							{pending ? "Reordering…" : "Reorder commits"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

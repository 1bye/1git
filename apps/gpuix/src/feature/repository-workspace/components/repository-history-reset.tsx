import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type { CommitInfo, ResetCommitInput, ResetCommitPlan } from "@1git/git";
import { useEffect, useRef, useState } from "react";
import { RepositoryHistory } from "../lib/repository-history";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import { appTokens } from "../../../styles/tokens";

const reviewTimeoutMs = 10_000;

/** Captured target and branch identity remain independent of later list selection. */
export interface HistoryResetReview {
	readonly root: string;
	readonly commit: CommitInfo;
	readonly input: ResetCommitInput;
}

/** Reviews publication and confirms a non-destructive reset to one exact ancestor. */
export function RepositoryHistoryReset({
	state,
	review,
	read = RepositoryHistory.readReset,
	onWrite,
	onCancel,
	onFinished,
}: {
	state: RepositoryWorkspaceState;
	review: HistoryResetReview;
	read?: typeof RepositoryHistory.readReset;
	onWrite: (input: ResetCommitInput) => Promise<string | null>;
	onCancel: () => void;
	onFinished: () => void;
}) {
	const [plan, setPlan] = useState<ResetCommitPlan | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const submitting = useRef(false);
	const busy = pending || RepositoryWorkspaceModel.isBusy(state);

	const unavailable =
		state.repository?.root !== review.root ||
		state.repository.head !== review.input.expectedHead ||
		state.repository.branchName !== review.input.expectedBranch ||
		state.repository.operation !== "normal" ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		state.entries.changes.length > 0;

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
					setError("Could not review the reset. Cancel and refresh History.");
			}
		};

		void load();

		return () => controller.abort();
	}, [read, review]);

	const submit = async (): Promise<void> => {
		if (busy || unavailable || !plan || submitting.current) return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const failure = await onWrite(review.input);

			if (failure) {
				setError(failure);
				setPlan(null);
			} else onFinished();
		} catch {
			setError(
				"Could not confirm the reset. Refresh and inspect History before retrying."
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
				width={420}
				dismissible={!busy}
				aria-label="Reset to commit"
				testId="reset-dialog"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text tokens={appTokens} size="lg">
						Reset to commit
					</Text>
					<Text
						tokens={appTokens}
						size="sm"
					>{`${review.commit.oid.slice(0, 7)} · ${review.commit.summary}`}</Text>
					{plan ? (
						<Text
							tokens={appTokens}
							testId="reset-count"
						>{`Undo ${plan.commitCount} later ${plan.commitCount === 1 ? "commit" : "commits"}. The selected commit stays.`}</Text>
					) : !error ? (
						<Text tokens={appTokens} tone="muted">
							Reviewing history…
						</Text>
					) : null}
					<Text tokens={appTokens} size="sm" tone="muted">
						Files stay unchanged. The undone changes return to Changes, ready to
						edit or commit again. Original history is retained for recovery.
					</Text>
					<Text tokens={appTokens} size="xs" tone="muted">
						Only unpublished history. Fetch first if another tool may have
						pushed. Other branches and existing tags stay unchanged.
					</Text>
					{error || unavailable ? (
						<Text
							tokens={appTokens}
							tone="danger"
							role="alert"
							testId="reset-error"
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
							testId="reset-cancel"
							disabled={busy}
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							tokens={appTokens}
							size="sm"
							testId="reset-confirm"
							disabled={busy || unavailable || !plan}
							onPress={() => {
								void submit();
							}}
						>
							{pending ? "Resetting…" : "Reset to commit"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

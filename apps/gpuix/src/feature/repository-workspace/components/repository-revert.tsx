import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type { CommitInfo, RevertCommitInput } from "@1git/git";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { useRef, useState, type ReactNode } from "react";
import { appTokens } from "../../../styles/tokens";
import { NativeFileMenu } from "../lib/native-file-menu";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { WorkspaceEntry } from "../types";

/** Native History action with an exact reviewed commit/branch captured before confirmation. */
export function RepositoryRevert({
	state,
	onWrite,
	onFinished,
	children,
}: {
	state: RepositoryWorkspaceState;
	onWrite?: (request: RevertCommitInput) => Promise<string | null>;
	onFinished: () => void;
	children: (
		onMenu: (entry: WorkspaceEntry, event: EventPayload) => void
	) => ReactNode;
}) {
	const renderer = useGpuixRequired();
	const tracking = useRef(false);
	const submitting = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [reviewed, setReviewed] = useState<{
		commit: CommitInfo;
		request: RevertCommitInput;
	} | null>(null);

	const busy = pending || RepositoryWorkspaceModel.isBusy(state);
	const repository = state.repository;

	const unavailable =
		!onWrite || state.preview || !repository?.head || !repository.branchName
			? "Open a committed branch to revert."
			: busy || state.loading || state.error || state.commit.needsReview
				? "Wait for the current operation or refresh first."
				: repository.operation !== "normal"
					? "Finish the current Git operation first."
					: state.entries.changes.length > 0
						? "Commit or stash your changes first."
						: null;

	const changed =
		reviewed &&
		(reviewed.request.expectedHead !== repository?.head ||
			reviewed.request.expectedBranch !== repository?.branchName);

	const openMenu = (entry: WorkspaceEntry, event: EventPayload): void => {
		if (tracking.current || reviewed) return;

		const commit = state.entries.history.find(
			(item) => item.id === entry.id
		)?.commit;

		if (!commit) return;

		tracking.current = true;
		setError(null);

		try {
			const reason =
				unavailable ??
				(commit.parentOids.length > 1
					? "Merge commits require a mainline parent in an external Git tool."
					: null);

			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.show(
				renderer,
				reason ? ["Revert commit…", reason] : ["Revert commit…"],
				reason ? [false, false] : [true],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice === 0 && !reason && repository?.head && repository.branchName)
				setReviewed({
					commit,
					request: {
						commit: commit.oid,
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					},
				});
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not open History actions."
			);
		} finally {
			tracking.current = false;
		}
	};

	const submit = async (): Promise<void> => {
		if (!reviewed || !onWrite || unavailable || changed || submitting.current)
			return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			await onWrite(reviewed.request);
			setReviewed(null);
			// The window-owned mutation publishes success/errors and conflict controls in Changes.
			onFinished();
		} catch {
			setError(
				"Could not confirm the revert. Refresh and inspect History before retrying."
			);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	};

	return (
		<>
			{children(openMenu)}
			{error && !reviewed ? (
				<text
					role="alert"
					style={{ ...typography.xs, color: appTokens.colors.danger }}
				>
					{error}
				</text>
			) : null}
			<Popover
				open={reviewed !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setReviewed(null);
				}}
			>
				<PopoverContent
					tokens={appTokens}
					placement="center"
					width={420}
					dismissible={!busy}
					aria-label="Revert commit"
					testId="revert-dialog"
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[3],
						}}
					>
						<text style={{ ...typography.lg, color: appTokens.colors.text }}>
							Revert this commit?
						</text>
						<text
							testId="revert-commit"
							style={{ ...typography.sm, color: appTokens.colors.text }}
						>
							{reviewed?.commit.summary}
						</text>
						<text
							style={{ ...typography.xs, color: appTokens.colors.textMuted }}
						>
							{reviewed
								? `${reviewed.commit.oid.slice(0, 7)} · ${reviewed.request.expectedBranch}`
								: ""}
						</text>
						<text
							style={{ ...typography.sm, color: appTokens.colors.textMuted }}
						>
							Creates a new commit that reverses these changes. Existing history
							stays intact, including published commits.
						</text>
						{error || changed || (!pending && unavailable) ? (
							<text
								role="alert"
								style={{ ...typography.xs, color: appTokens.colors.danger }}
							>
								{error ??
									(changed
										? "The branch changed. Cancel and review History again."
										: unavailable)}
							</text>
						) : null}
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								justifyContent: "flex-end",
								gap: spacing[2],
							}}
						>
							<Button
								tokens={appTokens}
								testId="revert-cancel"
								variant="secondary"
								disabled={busy}
								onPress={() => setReviewed(null)}
							>
								Cancel
							</Button>
							<Button
								tokens={appTokens}
								testId="revert-confirm"
								disabled={!!unavailable || !!changed}
								onPress={() => {
									void submit();
								}}
							>
								{pending ? "Reverting…" : "Revert commit"}
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}

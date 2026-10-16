import { MachineLocation } from "../../machines/machine-location";
import { useAppTheme } from "../../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { useState } from "react";
import type { FinishOperationInput } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";

import { RepositoryFileActions } from "../lib/repository-file-actions";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

/** Compact operation status; destructive abort captures the reviewed identity before confirmation. */
export function RepositoryOperation({
	state,
	onWrite,
}: {
	state: RepositoryWorkspaceState;
	onWrite: (request: FinishOperationInput) => Promise<string | null>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [confirmation, setConfirmation] = useState<FinishOperationInput | null>(
		null
	);

	const [error, setError] = useState<string | null>(null);
	const repository = state.repository;
	const operation = repository?.operation;

	const operationName =
		operation === "squash-merge" ? "squash merge" : operation;

	const active =
		operation === "merge" ||
		operation === "rebase" ||
		operation === "squash-merge" ||
		operation === "revert" ||
		operation === "cherry-pick";

	const busy = RepositoryWorkspaceModel.isBusy(state);

	const disabled =
		busy ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		state.preview ||
		!repository?.operationToken;

	const conflicts = state.entries.changes.filter(
		(entry) => entry.change?.recordType === "unmerged"
	).length;

	const unstaged = state.entries.changes.some(
		({ change }) =>
			change &&
			change.recordType !== "untracked" &&
			change.recordType !== "ignored" &&
			change.worktreeStatus !== "unmodified"
	);

	const title =
		operation === "merge"
			? "Merge"
			: operation === "rebase"
				? "Rebase"
				: operation === "squash-merge"
					? "Squash merge"
					: operation === "cherry-pick"
						? "Cherry-pick"
						: "Revert";

	const request = (
		kind: FinishOperationInput["kind"]
	): FinishOperationInput | null =>
		active && repository?.operationToken
			? {
					kind,
					expectedOperation: operation,
					expectedHead: repository.head,
					expectedBranch: repository.branchName,
					expectedToken: repository.operationToken,
				}
			: null;

	const submit = async (value: FinishOperationInput | null) => {
		if (!value || disabled) return;

		setError(null);

		try {
			const message = await onWrite(value);

			setError(message);

			if (!message) setConfirmation(null);
		} catch {
			setError("Could not confirm the Git action. Refresh before retrying.");
		}
	};

	const message =
		state.operationMutation.error ?? error ?? state.operationMutation.notice;

	if (!active && !message && !state.operationMutation.pending) return null;

	return (
		<div
			testId="operation-strip"
			style={{
				display: "flex",
				flexDirection: "column",
				padding: spacing[2],
				gap: spacing[1.5],
				flexShrink: 0,
				borderBottomWidth: 1,
				borderColor: appTokens.colors.border,
			}}
		>
			{active ? (
				<>
					<text
						role="status"
						testId="operation-status"
						style={{ ...typography.sm, color: appTokens.colors.text }}
					>
						{state.operationMutation.pending
							? `${title} action in progress…`
							: `${title} in progress · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`}
					</text>
					<div
						style={{ display: "flex", flexDirection: "row", gap: spacing[1.5] }}
					>
						<Button
							testId="operation-continue"
							tokens={appTokens}
							size="sm"
							disabled={disabled || conflicts > 0 || unstaged}
							onPress={() => {
								void submit(request("continue"));
							}}
						>
							{`Continue ${operationName}`}
						</Button>
						<Popover
							open={confirmation !== null}
							onOpenChange={(open) => {
								if (!busy) {
									setError(null);
									setConfirmation(open ? request("abort") : null);
								}
							}}
							modal
						>
							<PopoverTrigger asChild>
								<Button
									testId="operation-abort"
									tokens={appTokens}
									size="sm"
									variant="ghost"
									disabled={disabled}
								>
									Abort…
								</Button>
							</PopoverTrigger>
							<PopoverContent
								tokens={appTokens}
								aria-label="Confirm abort"
								side="bottom"
								align="start"
								dismissible={!busy}
							>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: spacing[2],
									}}
								>
									<text
										style={{ ...typography.sm, color: appTokens.colors.text }}
									>
										{`Abort ${confirmation?.expectedOperation === "squash-merge" ? "squash merge" : confirmation?.expectedOperation}?`}
									</text>
									<text
										style={{
											...typography.xs,
											color: appTokens.colors.textMuted,
										}}
									>
										Git will attempt to return to the pre-operation state.
										Conflict-resolution edits may be lost. Save any work you
										need before aborting.
									</text>
									<div
										style={{
											display: "flex",
											flexDirection: "row",
											justifyContent: "flex-end",
											gap: spacing[1.5],
										}}
									>
										<Button
											testId="operation-abort-cancel"
											tokens={appTokens}
											size="sm"
											variant="ghost"
											disabled={busy}
											onPress={() => setConfirmation(null)}
										>
											Cancel
										</Button>
										<Button
											testId="operation-abort-confirm"
											tokens={appTokens}
											size="sm"
											disabled={disabled}
											onPress={() => {
												void submit(confirmation);
											}}
										>
											{`Abort ${confirmation?.expectedOperation === "squash-merge" ? "squash merge" : confirmation?.expectedOperation}`}
										</Button>
									</div>
									{error ? (
										<text
											role="alert"
											style={{
												...typography.xs,
												color: appTokens.colors.danger,
											}}
										>
											{error}
										</text>
									) : null}
								</div>
							</PopoverContent>
						</Popover>
					</div>
					{!conflicts && unstaged ? (
						<text
							style={{ ...typography.xs, color: appTokens.colors.textMuted }}
						>
							Additional file edits are not confirmed for this operation. Review
							them in Git before continuing.
						</text>
					) : null}
					<text style={{ ...typography.xs, color: appTokens.colors.textMuted }}>
						{conflicts > 0
							? "Select each conflicted file, choose a side or edit it, then mark it resolved."
							: !unstaged
								? `All conflicts resolved. Continue ${operation} when ready.`
								: "Continue uses the confirmed resolutions and existing message."}
					</text>
				</>
			) : null}
			{message ? (
				<text
					testId="operation-result"
					role={state.operationMutation.error || error ? "alert" : "status"}
					style={{
						...typography.xs,
						color:
							state.operationMutation.error || error
								? appTokens.colors.danger
								: appTokens.colors.textMuted,
					}}
				>
					{message}
				</text>
			) : null}
			{state.operationMutation.recoveryDirectory ? (
				<Button
					testId="show-recovery-backup"
					tokens={appTokens}
					size="sm"
					variant="ghost"
					onPress={() => {
						const directory = state.operationMutation.recoveryDirectory;

						if (directory)
							void RepositoryFileActions.revealRecovery(directory).catch(() =>
								setError(
									`Recovery backup: ${MachineLocation.display(directory)}`
								)
							);
					}}
				>
					Show recovery backup
				</Button>
			) : null}
		</div>
	);
}

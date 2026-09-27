import { useState } from "react";
import type { FinishOperationInput } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import { appTokens } from "../../../styles/tokens";
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
	const [confirmation, setConfirmation] = useState<FinishOperationInput | null>(
		null
	);

	const [error, setError] = useState<string | null>(null);
	const repository = state.repository;
	const operation = repository?.operation;
	const active = operation === "merge" || operation === "rebase";
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

	const title = operation === "merge" ? "Merge" : "Rebase";

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
				padding: 8,
				gap: 6,
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
						style={{ fontSize: 11, color: appTokens.colors.text }}
					>
						{state.operationMutation.pending
							? `${title} action in progress…`
							: `${title} in progress · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`}
					</text>
					<div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
						<Button
							testId="operation-continue"
							tokens={appTokens}
							size="sm"
							disabled={disabled || conflicts > 0 || unstaged}
							onPress={() => {
								void submit(request("continue"));
							}}
						>
							Continue {operation}
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
									style={{ display: "flex", flexDirection: "column", gap: 8 }}
								>
									<text style={{ fontSize: 11, color: appTokens.colors.text }}>
										Abort {confirmation?.expectedOperation}?
									</text>
									<text
										style={{ fontSize: 10, color: appTokens.colors.textMuted }}
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
											gap: 6,
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
											Abort {confirmation?.expectedOperation}
										</Button>
									</div>
									{error ? (
										<text
											role="alert"
											style={{ fontSize: 10, color: appTokens.colors.danger }}
										>
											{error}
										</text>
									) : null}
								</div>
							</PopoverContent>
						</Popover>
					</div>
					{!conflicts && unstaged ? (
						<text style={{ fontSize: 10, color: appTokens.colors.textMuted }}>
							Review and stage remaining tracked edits before continuing.
						</text>
					) : null}
					<text style={{ fontSize: 10, color: appTokens.colors.textMuted }}>
						Continue uses Git’s staged changes and existing message.
					</text>
				</>
			) : null}
			{message ? (
				<text
					testId="operation-result"
					role={state.operationMutation.error || error ? "alert" : "status"}
					style={{ fontSize: 10, color: appTokens.colors.textMuted }}
				>
					{message}
				</text>
			) : null}
		</div>
	);
}

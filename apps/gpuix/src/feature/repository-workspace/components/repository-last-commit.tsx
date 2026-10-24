import { useAppTheme } from "../../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import type { CommitInfo, CommitRecoveryInput } from "@1git/git";
import { useGpuixRequired, type NativeRenderer } from "@gpuix/react";
import { useEffect, useMemo, useState } from "react";

import { WorkspaceMenuModel } from "../../workspace-tabs/lib/workspace-menu-model";
import { RepositoryCommit, type LastCommit } from "../lib/repository-commit";
import { RepositoryCommitSubject } from "./repository-commit-subject";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

const summaryLimit = 128;

type CommitSummary = Pick<CommitInfo, "summary" | "committedAt">;

// Only immutable commit metadata survives remounts; recovery eligibility is always reread.
const summariesByWindow = new WeakMap<
	NativeRenderer,
	Map<string, CommitSummary>
>();

/** Pinned last-commit summary with backend-revalidated amend and undo actions. */
export function RepositoryLastCommit({
	state,
	onUndo,
	onAmend,
	readLast = RepositoryCommit.readLast,
}: {
	state: RepositoryWorkspaceState;
	onUndo?: (input: CommitRecoveryInput) => Promise<string | null>;
	onAmend?: (commit: CommitInfo) => void;
	readLast?: typeof RepositoryCommit.readLast;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const renderer = useGpuixRequired();

	const summaries = useMemo(() => {
		const existing = summariesByWindow.get(renderer);

		if (existing) return existing;

		const entries = new Map<string, CommitSummary>();

		summariesByWindow.set(renderer, entries);

		return entries;
	}, [renderer]);

	const root = state.repository?.root;
	const head = state.repository?.head;
	const branch = state.repository?.branchName;
	const summaryKey = JSON.stringify([root, head]);

	const key = JSON.stringify([
		root,
		head,
		branch,
		state.repository?.operation,
		state.sync.version,
	]);

	const [result, setResult] = useState<{
		key: string;
		value?: LastCommit;
		error?: string;
	} | null>(null);

	const [retry, setRetry] = useState(0);
	const current = result?.key === key ? result : null;
	const busy = RepositoryWorkspaceModel.isBusy(state);

	useEffect(() => {
		if (!root || !head || !branch) return;

		const controller = new AbortController();

		const load = async () => {
			try {
				const loaded = await readLast(root, {
					expectedHead: head,
					expectedBranch: branch,
					signal: controller.signal,
				});

				if (controller.signal.aborted) return;

				if (loaded.ok) {
					const { summary, committedAt } = loaded.value.commit;

					summaries.delete(summaryKey);
					summaries.set(summaryKey, { summary, committedAt });

					if (summaries.size > summaryLimit) {
						const oldest = summaries.keys().next().value;

						if (oldest !== undefined) summaries.delete(oldest);
					}
				}

				setResult(
					loaded.ok
						? { key, value: loaded.value }
						: { key, error: loaded.error.message }
				);
			} catch (cause) {
				if (!controller.signal.aborted)
					setResult({
						key,
						error:
							cause instanceof Error
								? cause.message
								: "Could not read the last commit.",
					});
			}
		};

		void load();

		return () => controller.abort();
	}, [root, head, branch, key, retry, readLast, summaries, summaryKey]);

	if (!root || !head || !branch) return null;

	const last = current?.value;

	const commit = current?.error
		? undefined
		: (last?.commit ?? summaries.get(summaryKey));

	const age = commit ? WorkspaceMenuModel.commitAge(commit.committedAt) : "";

	const unavailable =
		!last ||
		!!last.undoUnavailableReason ||
		!!state.amend ||
		!RepositoryWorkspaceModel.canRecoverCommit(state);

	const disabled = unavailable || !onUndo;

	return (
		<div
			testId="last-commit-footer"
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: spacing[1],
				flexShrink: 0,
				minHeight: 48,
				padding: spacing[2.5],
				borderTopWidth: 1,
				borderColor: appColors.editorHairline,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: spacing[0.5],
					flexGrow: 1,
					flexShrink: 1,
					minWidth: 0,
					overflow: "hidden",
				}}
			>
				<text style={{ ...typography.xs, color: appTokens.colors.textMuted }}>
					{commit
						? `Committed${age ? ` ${age}` : ""}`
						: current?.error
							? "Could not read last commit"
							: "Last commit"}
				</text>
				<div
					style={{
						display: "flex",
						height: typography.sm.lineHeight,
						flexShrink: 0,
					}}
				>
					{commit ? (
						<RepositoryCommitSubject
							subject={commit.summary}
							testId="last-commit-summary"
						/>
					) : (
						<text
							testId="last-commit-summary"
							style={{
								...typography.sm,
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								overflow: "hidden",
							}}
						>
							{current?.error ?? ""}
						</text>
					)}
				</div>
			</div>
			{!current?.error && !state.amend ? (
				<Button
					testId="commit-amend"
					aria-label="Amend last commit"
					aria-description={
						last?.undoUnavailableReason ??
						"Edit the unpublished last commit's message and optionally include checked changes."
					}
					variant="secondary"
					size="sm"
					tokens={appTokens}
					disabled={unavailable || !onAmend}
					onPress={() => {
						if (!unavailable && last) onAmend?.(last.commit);
					}}
				>
					Amend
				</Button>
			) : null}
			<Button
				testId="commit-undo"
				aria-label={
					current?.error ? "Retry reading last commit" : "Undo last commit"
				}
				aria-description={
					last?.undoUnavailableReason ??
					"Keep your files and existing changes, and restore the last commit message when the draft is empty."
				}
				variant="secondary"
				size="sm"
				tokens={appTokens}
				disabled={current?.error ? busy : disabled}
				onPress={() => {
					if (current?.error) {
						setRetry((value) => value + 1);

						return;
					}

					if (disabled) return;

					void onUndo?.({ expectedHead: head, expectedBranch: branch });
				}}
			>
				{current?.error ? "Retry" : "Undo"}
			</Button>
		</div>
	);
}

import { useAppTheme } from "../../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";

import type { WorkspaceTabsState } from "../../workspace-tabs/lib/workspace-tabs-model";
import { RepositoryWorkspaceModel } from "../lib/repository-workspace-model";

/** Window-wide progress after a blocked close, including operations in background tabs. */
export function RepositoryCloseNotice({
	state,
	onDismiss,
	onStop,
}: {
	state: WorkspaceTabsState;
	onDismiss: () => void;
	onStop: (id: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const seen = new Set<string>();

	const operations = state.tabs.filter(({ workspace }) => {
		if (!RepositoryWorkspaceModel.isBusy(workspace)) return false;

		if (!workspace.repository) return true;

		const key =
			workspace.sync.pending || workspace.stashMutation.pending
				? workspace.repository.commonDirectory
				: workspace.repository.root;

		if (seen.has(key)) return false;

		seen.add(key);

		return true;
	});

	return (
		<div
			testId="close-protection-notice"
			style={{
				display: "flex",
				flexDirection: "column",
				paddingLeft: spacing[3],
				paddingRight: spacing[3],
				paddingTop: spacing[2],
				paddingBottom: spacing[2],
				gap: spacing[1],
				flexShrink: 0,
				borderBottomWidth: 1,
				borderColor: appTokens.colors.border,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[2],
					minWidth: 0,
				}}
			>
				<text
					role="alert"
					style={{
						...typography.sm,
						color: appTokens.colors.text,
						flexGrow: 1,
						minWidth: 0,
						whiteSpace: "normal",
					}}
				>
					{operations.length
						? "Git is still working. Keep this window open until it finishes."
						: "Git operations have finished. Review the results; you can close the window now."}
				</text>
				<Button
					testId="close-keep-working"
					tokens={appTokens}
					size="sm"
					variant="ghost"
					onPress={onDismiss}
				>
					{operations.length ? "Keep working" : "Dismiss"}
				</Button>
			</div>
			{operations.map(({ id, name, workspace }) => (
				<div
					key={id}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: spacing[2],
					}}
				>
					<text
						style={{
							...typography.sm,
							color: appTokens.colors.textMuted,
							flexGrow: 1,
							minWidth: 0,
							whiteSpace: "normal",
						}}
					>
						{`${name} · ${
							workspace.commit.pending
								? "Committing…"
								: workspace.operationMutation.pending
									? "Updating repository…"
									: workspace.conflictPending
										? "Resolving conflict…"
										: workspace.branchPending
											? "Changing branch…"
											: workspace.stashMutation.pending
												? `Stash ${workspace.stashMutation.pending} in progress…`
												: `${workspace.sync.pending} in progress…`
						}`}
					</text>
					{workspace.sync.pending ? (
						<Button
							testId={`close-stop-${id}`}
							tokens={appTokens}
							size="sm"
							variant="ghost"
							onPress={() => onStop(id)}
						>
							Stop synchronization
						</Button>
					) : null}
				</div>
			))}
			{operations.some(({ workspace }) => workspace.sync.pending) ? (
				<text
					style={{
						...typography.xs,
						color: appTokens.colors.textMuted,
						whiteSpace: "normal",
					}}
				>
					Stopping may not undo remote changes. The window stays open until
					status is refreshed.
				</text>
			) : null}
		</div>
	);
}

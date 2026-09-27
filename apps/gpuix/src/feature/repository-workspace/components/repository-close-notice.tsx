import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "../../../styles/tokens";
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
	const seen = new Set<string>();

	const operations = state.tabs.filter(({ workspace }) => {
		if (!RepositoryWorkspaceModel.isBusy(workspace) || !workspace.repository)
			return false;

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
			style={{ padding: 12, gap: 6, flexShrink: 0 }}
		>
			<text role="alert" style={{ fontSize: 12, color: appTokens.colors.text }}>
				{operations.length
					? "Git is still working. Keep this window open until it finishes."
					: "Git operations have finished. Review the results; you can close the window now."}
			</text>
			{operations.map(({ id, name, workspace }) => (
				<div
					key={id}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
					}}
				>
					<text style={{ fontSize: 11, color: appTokens.colors.textMuted }}>
						{`${name} · ${
							workspace.commit.pending
								? "Committing…"
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
				<text style={{ fontSize: 11, color: appTokens.colors.textMuted }}>
					Stopping may not undo remote changes. The window stays open until
					status is refreshed.
				</text>
			) : null}
			<div style={{ display: "flex", flexDirection: "row" }}>
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
		</div>
	);
}

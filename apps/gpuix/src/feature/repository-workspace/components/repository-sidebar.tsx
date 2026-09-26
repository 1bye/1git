import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";

import { appTokens } from "../../../styles/tokens";
import { workspaceLayout as layout } from "../../../styles/workspace-layout";
import type {
	RepositoryWorkspaceAction,
	RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import { repositoryViews, sampleEntries } from "../lib/sample-workspace";
import { RepositoryList } from "./repository-list";
import { RepositoryIcon } from "./repository-icon";

const styles = StyleSheet.create({
	sidebar: {
		display: "flex",
		flexDirection: "column",
		width: 310,
		flexShrink: 0,
		minHeight: 0,
	},
	toolbar: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		height: layout.toolbarHeight,
		flexShrink: 0,
		paddingLeft: layout.desktopTitlebarControlsWidth,
		paddingRight: 8,
	},
	trigger: {
		minWidth: 104,
		height: 28,
		paddingLeft: 8,
		paddingRight: 8,
		backgroundColor: "transparent",
		borderColor: "transparent",
		hover: { backgroundColor: lightColors.editorHairline },
	},
	header: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 36,
		paddingLeft: 14,
		paddingRight: 14,
		flexShrink: 0,
	},
	muted: { fontSize: 10, color: lightColors.editorMuted },
	footer: {
		height: 32,
		display: "flex",
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingLeft: 14,
		paddingRight: 14,
		flexShrink: 0,
	},
	faint: { fontSize: 9, color: lightColors.editorFaint },
});

/** Full-height translucent navigation rail matching the desktop workspace composition. */
export function RepositorySidebar({
	workspaceId,
	state,
	onAction,
}: {
	workspaceId: string;
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
}) {
	const { view } = state;

	const heading =
		view === "changes"
			? "Working tree"
			: view === "history"
				? "Recent commits"
				: "Saved work";

	return (
		<div
			testId="repository-sidebar"
			role="navigation"
			aria-label="Repository navigation"
			style={styles.sidebar}
		>
			<div style={styles.toolbar}>
				<Select
					value={view}
					items={repositoryViews}
					onValueChange={(value) => {
						const next = repositoryViews.find((item) => item.value === value);

						if (next) onAction({ type: "view", view: next.value });
					}}
				>
					<SelectTrigger
						testId="repository-view"
						aria-label="Repository view"
						tokens={appTokens}
						style={styles.trigger}
					>
						<SelectValue tokens={appTokens} style={{ fontSize: 11 }} />
						<RepositoryIcon name="caret" />
					</SelectTrigger>
					<SelectContent tokens={appTokens}>
						{repositoryViews.map((item) => (
							<SelectItem
								key={item.value}
								value={item.value}
								testId={`view-${item.value}`}
								tokens={appTokens}
								style={{ fontSize: 11 }}
							>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div windowDrag style={{ flexGrow: 1, height: "100%" }} />
			</div>
			<div style={styles.header}>
				<text style={styles.muted}>{heading}</text>
				<text style={styles.faint}>{sampleEntries[view].length}</text>
			</div>
			<RepositoryList
				key={`${workspaceId}:${view}`}
				view={view}
				state={state.views[view]}
				onAction={onAction}
			/>
			<div style={styles.footer}>
				<text style={styles.faint}>Sample data</text>
				<text style={styles.faint}>↑ ↓ Navigate</text>
			</div>
		</div>
	);
}

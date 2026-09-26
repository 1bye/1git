import { lightColors, workspaceLayout } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { ReactNode } from "react";

const styles = StyleSheet.create({
	root: {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		// Keep dark text legible even when macOS supplies a dark vibrancy backdrop.
		backgroundColor: lightColors.studioGlassStrong,
		userSelect: "none",
	},
	content: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minWidth: 0,
		minHeight: 0,
	},
	workspace: {
		display: "flex",
		flexDirection: "row",
		flexGrow: 1,
		minHeight: 0,
		marginLeft: workspaceLayout.workspaceSurfaceInset,
		marginRight: workspaceLayout.workspaceSurfaceInset,
		marginBottom: workspaceLayout.workspaceSurfaceInset,
		borderRadius: workspaceLayout.workspaceSurfaceRadius,
		backgroundColor: lightColors.editorSurface,
		overflowX: "hidden",
		overflowY: "hidden",
	},
});

/** Native chrome composition; only the content surface is opaque. */
export function AppShell({
	toolbar,
	workspaceLabel,
	navigation,
	children,
}: {
	toolbar: ReactNode;
	workspaceLabel: string;
	navigation?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div testId="app-shell" style={styles.root}>
			{toolbar}
			<div
				testId="workspace"
				role="tabpanel"
				aria-label={workspaceLabel}
				style={styles.workspace}
			>
				{navigation}
				<div style={styles.content}>{children}</div>
			</div>
		</div>
	);
}

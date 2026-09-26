import { lightColors, workspaceLayout } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { ReactNode } from "react";

const styles = StyleSheet.create({
	root: {
		display: "flex",
		flexDirection: "row",
		width: "100%",
		height: "100%",
		// Keep dark text legible even when macOS supplies a dark vibrancy backdrop.
		backgroundColor: lightColors.studioGlassStrong,
		userSelect: "none",
	},
	main: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minWidth: 0,
	},
	workspace: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minHeight: 0,
		marginLeft: workspaceLayout.workspaceSurfaceInset,
		marginRight: workspaceLayout.workspaceSurfaceInset,
		marginBottom: workspaceLayout.workspaceSurfaceInset,
		borderRadius: workspaceLayout.workspaceSurfaceRadius,
		backgroundColor: lightColors.editorSurface,
	},
});

/** Native chrome composition; only the content surface is opaque. */
export function AppShell({
	toolbar,
	workspaceLabel,
	sidebar,
	children,
}: {
	toolbar: ReactNode;
	workspaceLabel: string;
	sidebar?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div testId="app-shell" style={styles.root}>
			{sidebar}
			<div style={styles.main}>
				{toolbar}
				<div
					testId="workspace"
					role="tabpanel"
					aria-label={workspaceLabel}
					style={styles.workspace}
				>
					{children}
				</div>
			</div>
		</div>
	);
}

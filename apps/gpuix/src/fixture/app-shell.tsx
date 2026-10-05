import { spacing, lightColors, workspaceLayout } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import type { ReactNode, Ref } from "react";
import type { PublicInstance } from "@gpuix/react";

const styles = StyleSheet.create({
	root: {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		flexShrink: 0,
		// AppKit owns the sidebar tint; only the workspace paints an opaque surface.
		backgroundColor: "transparent",
		userSelect: "none",
	},
	content: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minWidth: 0,
		minHeight: 0,
	},
	body: {
		display: "flex",
		flexDirection: "row",
		flexGrow: 1,
		minHeight: 0,
	},
	workspace: {
		display: "flex",
		flexDirection: "row",
		flexGrow: 1,
		minWidth: 0,
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
	rail,
	children,
	hidden = false,
	testId = "app-shell",
	ref,
}: {
	toolbar: ReactNode;
	workspaceLabel: string;
	navigation?: ReactNode;
	rail?: ReactNode;
	children?: ReactNode;
	hidden?: boolean;
	testId?: string;
	ref?: Ref<PublicInstance>;
}) {
	return (
		<div
			ref={ref}
			testId={testId}
			aria-hidden={hidden || undefined}
			style={StyleSheet.compose(
				styles.root,
				hidden
					? {
							position: "absolute",
							top: 0,
							left: 0,
							visibility: "hidden",
							pointerEvents: "none",
						}
					: undefined
			)}
		>
			{toolbar}
			<div style={styles.body}>
				{rail}
				<div
					testId="workspace"
					role="tabpanel"
					aria-label={workspaceLabel}
					style={StyleSheet.compose(
						styles.workspace,
						rail ? { marginLeft: spacing[0] } : undefined
					)}
				>
					{navigation}
					<div style={styles.content}>{children}</div>
				</div>
			</div>
		</div>
	);
}

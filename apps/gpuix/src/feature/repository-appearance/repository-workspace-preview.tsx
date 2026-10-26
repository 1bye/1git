import { StyleSheet } from "@1git/gpuix-stylesheet";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { workspaceLayout } from "../../styles/workspace-layout";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { workspaceRailIcons } from "../repository-workspace/components/workspace-rail-icons";
import { repositoryDiffTheme } from "../repository-workspace/lib/repository-diff-theme";
import { RepositoryPatternLayer } from "./repository-pattern-layer";

const samplePatch = `diff --git a/greeting.ts b/greeting.ts
--- a/greeting.ts
+++ b/greeting.ts
@@ -1,5 +1,5 @@
 export function greet(name: string) {
-  const greeting = "Hello";
+  const greeting = "Welcome";
   return greeting + ", " + name;
 }
 
`;

const themedStyles = createThemedStyles(({ colors, tokens }) =>
	StyleSheet.create({
		window: {
			display: "flex",
			flexDirection: "column",
			position: "relative",
			height: 248,
			minWidth: 0,
			overflowX: "hidden",
			overflowY: "hidden",
			borderWidth: 1,
			borderColor: tokens.colors.border,
			borderRadius: workspaceLayout.workspaceSurfaceRadius / 2,
			backgroundColor:
				colors.chrome === "transparent" ? colors.editorSunken2 : colors.chrome,
			color: colors.editorInk,
			fontSize: 8,
			lineHeight: 12,
			pointerEvents: "none",
		},
		titlebar: {
			display: "flex",
			flexDirection: "row",
			alignItems: "flex-end",
			height: workspaceLayout.toolbarHeight / 2,
			flexShrink: 0,
			paddingLeft: workspaceLayout.desktopTitlebarControlsWidth / 2,
			gap: 4,
		},
		lights: {
			position: "absolute",
			left: 8,
			top: 7,
			display: "flex",
			flexDirection: "row",
			gap: 4,
		},
		light: { width: 6, height: 6, borderRadius: 3 },
		home: {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: 16,
			height: workspaceLayout.tabHeight / 2,
			flexShrink: 0,
		},
		tab: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			height: workspaceLayout.tabHeight / 2,
			minWidth: 0,
			width: workspaceLayout.tabWidth / 2,
			paddingLeft: 6,
			paddingRight: 6,
			gap: 4,
			backgroundColor: colors.editorSurface,
			borderTopLeftRadius: workspaceLayout.tabRadius / 2,
			borderTopRightRadius: workspaceLayout.tabRadius / 2,
		},
		avatar: {
			width: 9,
			height: 9,
			borderRadius: 2,
			flexShrink: 0,
			backgroundColor: tokens.colors.selected,
			color: colors.brand,
			textAlign: "center",
			fontSize: 6,
			lineHeight: 9,
		},
		label: {
			minWidth: 0,
			flexShrink: 1,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			lineClamp: 1,
		},
		body: {
			position: "relative",
			display: "flex",
			flexDirection: "row",
			flexGrow: 1,
			minHeight: 0,
		},
		rail: {
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			width: 24,
			flexShrink: 0,
			paddingTop: 4,
			paddingBottom: 6,
			gap: 4,
		},
		railItem: {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: 18,
			height: 18,
			flexShrink: 0,
			borderRadius: 4,
		},
		selected: { backgroundColor: tokens.colors.selected },
		icon: { width: 11, height: 11, color: colors.editorMuted },
		spacer: { flexGrow: 1 },
		surface: {
			display: "flex",
			flexDirection: "row",
			flexGrow: 1,
			minWidth: 0,
			marginRight: workspaceLayout.workspaceSurfaceInset / 2,
			marginBottom: workspaceLayout.workspaceSurfaceInset / 2,
			borderRadius: workspaceLayout.workspaceSurfaceRadius / 2,
			backgroundColor: colors.editorSurface,
			overflowX: "hidden",
			overflowY: "hidden",
		},
		files: {
			display: "flex",
			flexDirection: "column",
			width: "32%",
			minWidth: 68,
			flexShrink: 0,
			borderRightWidth: 1,
			borderColor: colors.editorHairline,
		},
		header: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			height: 20,
			flexShrink: 0,
			paddingLeft: 6,
			paddingRight: 6,
			borderBottomWidth: 1,
			borderColor: colors.editorHairline,
		},
		muted: { color: colors.editorMuted, fontSize: 7 },
		selection: { paddingLeft: 6, paddingTop: 3, paddingBottom: 3 },
		file: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			height: 18,
			paddingLeft: 6,
			paddingRight: 4,
			gap: 4,
		},
		composer: {
			display: "flex",
			flexDirection: "column",
			gap: 5,
			padding: 5,
			borderTopWidth: 1,
			borderColor: colors.editorHairline,
		},
		field: {
			height: 40,
			padding: 4,
			borderWidth: 1,
			borderColor: tokens.colors.border,
			borderRadius: 3,
			color: colors.editorFaint,
			fontSize: 7,
		},
		commit: {
			alignSelf: "flex-end",
			paddingLeft: 6,
			paddingRight: 6,
			borderRadius: 3,
			backgroundColor: tokens.colors.accent,
			color: tokens.colors.onAccent,
			fontSize: 7,
		},
		diff: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minWidth: 0,
			overflowX: "hidden",
			overflowY: "hidden",
		},
	})
);

/** A static miniature of the native workspace, using its live palette and diff renderer. */
export function RepositoryWorkspacePreview({ name }: { name: string }) {
	const theme = useAppTheme();
	const styles = themedStyles.get(theme);
	const diff = repositoryDiffTheme.get(theme);

	return (
		<div
			testId="repository-appearance-preview"
			role="img"
			aria-label={`Workspace preview for ${name}: window controls and repository tab above the navigation rail, changed files, commit box and code diff.`}
			textScale={1}
			style={styles.window}
		>
			<div
				testId="repository-appearance-preview-titlebar"
				style={styles.titlebar}
			>
				<div
					testId="repository-appearance-preview-traffic-lights"
					style={styles.lights}
				>
					{["#ff5f57", "#febc2e", "#28c840"].map((color) => (
						<div
							key={color}
							style={{ ...styles.light, backgroundColor: color }}
						/>
					))}
				</div>
				<div style={styles.home}>
					<WorkspaceTabIcon name="home" size={10} />
				</div>
				<div testId="repository-appearance-preview-tab" style={styles.tab}>
					<text style={styles.avatar}>{name.slice(0, 1).toUpperCase()}</text>
					<text
						testId="repository-appearance-preview-tab-label"
						style={styles.label}
					>
						{`${name} / main`}
					</text>
					<WorkspaceTabIcon name="caretDown" size={7} />
				</div>
			</div>
			<div style={styles.body}>
				{theme.repositoryPattern ? (
					<RepositoryPatternLayer
						pattern={theme.repositoryPattern}
						seed={theme.repositoryPatternSeed}
						adjustments={theme.repositoryPatternAdjustments}
					/>
				) : null}
				<div testId="repository-appearance-preview-rail" style={styles.rail}>
					<div style={styles.railItem}>
						<WorkspaceTabIcon name="sync" size={11} />
					</div>
					{(["changes", "history", "graph", "stashes"] as const).map((view) => (
						<div
							key={view}
							style={StyleSheet.compose(
								styles.railItem,
								view === "changes" ? styles.selected : undefined
							)}
						>
							<svg source={workspaceRailIcons[view]} style={styles.icon} />
						</div>
					))}
					<div style={styles.spacer} />
					<svg source={workspaceRailIcons.settings} style={styles.icon} />
					<svg source={workspaceRailIcons.account} style={styles.icon} />
				</div>
				<div style={styles.surface}>
					<div
						testId="repository-appearance-preview-files"
						style={styles.files}
					>
						<div style={styles.header}>
							<text>Changes</text>
							<WorkspaceTabIcon name="sync" size={8} />
						</div>
						<text style={{ ...styles.muted, ...styles.selection }}>
							2 files changed
						</text>
						{["greeting.ts", "README.md"].map((file, index) => (
							<div
								key={file}
								style={StyleSheet.compose(
									styles.file,
									index === 0 ? styles.selected : undefined
								)}
							>
								<WorkspaceTabIcon name="check" size={7} />
								<text style={styles.label}>{file}</text>
							</div>
						))}
						<div style={styles.spacer} />
						<div
							testId="repository-appearance-preview-commit"
							style={styles.composer}
						>
							<text style={styles.field}>Commit message</text>
							<text style={styles.commit}>Commit</text>
							<text style={{ ...styles.muted, ...styles.label }}>
								Last commit · just now
							</text>
						</div>
					</div>
					<div testId="repository-appearance-preview-diff" style={styles.diff}>
						<div style={styles.header}>
							<text style={styles.label}>greeting.ts</text>
							<WorkspaceTabIcon name="tabs" size={9} />
						</div>
						<diff
							patch={samplePatch}
							showFileHeader={false}
							selectionEnabled={false}
							theme={{
								...diff,
								metrics: {
									...diff.metrics,
									diffTextSize: 7,
									diffLineHeight: 12,
									diffHunkHeaderHeight: 12,
									diffGutterWidth: 12,
									diffMarkerWidth: 7,
									diffRowPaddingX: 3,
								},
							}}
							style={{ flexGrow: 1, minWidth: 0 }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

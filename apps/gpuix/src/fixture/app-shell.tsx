import {
	AppThemeContext,
	createThemedStyles,
	useAppTheme,
	type AppTheme,
} from "../styles/theme";
import { spacing, workspaceLayout } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { useMemo, useState, type ReactNode, type Ref } from "react";
import type { PublicInstance } from "@gpuix/react";
import { WorkspaceCornerContext } from "./workspace-corner";
import { chromeGrainSource } from "./chrome-grain";
import { RepositoryPatternLayer } from "../feature/repository-appearance/repository-pattern-layer";
import { useThemeTransition } from "../styles/theme-transition";

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		root: {
			position: "relative",
			display: "flex",
			flexDirection: "column",
			width: "100%",
			height: "100%",
			flexShrink: 0,
			// AppKit owns the blurred material in both appearances; never paint over it.
			backgroundColor: appColors.chrome,
			color: appColors.editorInk,
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
			position: "relative",
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
			// Motion's shorthand animates only the remaining top-right corner.
			borderTopLeftRadius: workspaceLayout.workspaceSurfaceRadius,
			borderBottomLeftRadius: workspaceLayout.workspaceSurfaceRadius,
			borderBottomRightRadius: workspaceLayout.workspaceSurfaceRadius,
			backgroundColor: appColors.editorSurface,
			overflowX: "hidden",
			overflowY: "hidden",
		},
	});

	return { styles };
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
	palette,
}: {
	toolbar: ReactNode;
	workspaceLabel: string;
	navigation?: ReactNode;
	rail?: ReactNode;
	children?: ReactNode;
	hidden?: boolean;
	testId?: string;
	ref?: Ref<PublicInstance>;
	/** Scopes repo colors to the workspace; neutral toolbars may provide their own theme. */
	palette?: AppTheme;
}) {
	const inherited = useAppTheme();

	const targetTheme = useMemo(
		() => (palette ? { ...inherited, ...palette } : inherited),
		[inherited, palette]
	);

	const theme = useThemeTransition(targetTheme, !!inherited.smoothTransitions);

	const { styles } = themedStyles.get(theme);

	const [rightRadius, setRightRadius] = useState<number>(
		workspaceLayout.workspaceSurfaceRadius
	);

	return (
		<AppThemeContext value={theme}>
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
				<svg
					testId="repository-chrome-grain"
					aria-hidden
					source={chromeGrainSource}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						height: "100%",
						pointerEvents: "none",
						opacity: theme.appearance === "dark" ? 0.12 : 0.09,
						color: theme.appearance === "dark" ? "#ffffff" : "#000000",
					}}
				/>
				<WorkspaceCornerContext value={setRightRadius}>
					{toolbar}
				</WorkspaceCornerContext>
				<div style={styles.body}>
					{theme.repositoryPattern ? (
						<RepositoryPatternLayer pattern={theme.repositoryPattern} />
					) : null}
					{rail}
					<div
						testId="workspace"
						role="tabpanel"
						aria-label={workspaceLabel}
						motion={{
							initial: false,
							animate: { borderRadius: rightRadius },
							transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
						}}
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
		</AppThemeContext>
	);
}

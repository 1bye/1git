import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, fontWeight, iconSize } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	OverflowingLabel,
	type OverflowingLabelHandle,
} from "../../../fixture/overflowing-label";
import type { Ref } from "react";

import type { WorkspaceEntry } from "../types";
import { repositoryConflictTheme } from "../lib/repository-conflict-theme";

const statusSymbols = {
	M: '<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
	A: '<path d="M5 8h6M8 5v6"/>',
	D: '<path d="M5 8h6"/>',
	R: '<path d="M5 8h6m-3-3 3 3-3 3"/>',
	C: '<path d="M6 6h5v5H6zM4 9V4h5"/>',
	U: '<path d="M8 5v4m0 2h.01"/>',
	T: '<path d="M5 5h6M8 5v6"/>',
};

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		identity: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[2],
			flexGrow: 1,
			minWidth: 0,
			pointerEvents: "none",
		},
		nameAndPath: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
			flexGrow: 1,
			minWidth: 0,
			overflowX: "hidden",
		},
		filename: {
			...typography.sm,
			fontWeight: fontWeight.regular,
			color: appColors.editorInk,
			flexShrink: 0,
			whiteSpace: "nowrap",
		},
		path: {
			...typography.xs,
			color: appColors.editorFaint,
			flexShrink: 0,
			whiteSpace: "nowrap",
		},
	});

	return { styles };
});

/** Filename-first identity for changed files; the full path remains in the row's accessible label. */
export function RepositoryChangeLabel({
	ref,
	entry,
	showDirectory = true,
	reveal = false,
}: {
	ref?: Ref<OverflowingLabelHandle>;
	entry: WorkspaceEntry;
	showDirectory?: boolean;
	reveal?: boolean;
}) {
	const theme = useAppTheme();
	const { colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	const slash = entry.title.lastIndexOf("/");
	const filename = entry.title.slice(slash + 1);
	const directory = slash < 0 ? "" : entry.title.slice(0, slash);
	const status = entry.status ?? "M";
	const conflictColors = repositoryConflictTheme.get(theme).warning;

	return (
		<div style={styles.identity}>
			<svg
				testId={`status-${entry.id}`}
				source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/>${statusSymbols[status]}</svg>`}
				style={{
					width: iconSize.xs,
					height: iconSize.xs,
					flexShrink: 0,
					color:
						status === "U"
							? conflictColors.ink
							: status === "A"
								? appColors.success
								: status === "D"
									? appColors.editorFaint
									: appColors.brand,
				}}
			/>
			<OverflowingLabel
				ref={ref}
				testId={`identity-${entry.id}`}
				reveal={reveal}
				contentKey={JSON.stringify([entry.title, showDirectory])}
				style={styles.nameAndPath}
				gap={spacing[1.5]}
			>
				<text
					testId={`filename-${entry.id}`}
					style={StyleSheet.compose(
						styles.filename,
						status === "D" && {
							color: appColors.editorMuted,
							textDecoration: "line-through",
						}
					)}
				>
					{filename}
				</text>
				{showDirectory && directory ? (
					<text testId={`directory-${entry.id}`} style={styles.path}>
						{directory}
					</text>
				) : null}
			</OverflowingLabel>
			{status === "U" ? (
				<text
					testId={`conflict-status-${entry.id}`}
					style={{
						...typography["2xs"],
						color: conflictColors.ink,
						backgroundColor: conflictColors.wash,
						borderRadius: 4,
						paddingLeft: spacing[1.5],
						paddingRight: spacing[1.5],
					}}
				>
					Unresolved
				</text>
			) : null}
		</div>
	);
}

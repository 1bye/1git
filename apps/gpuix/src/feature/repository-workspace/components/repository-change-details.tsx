import {
	spacing,
	typography,
	fontWeight,
	iconSize,
	lightColors,
} from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import type { WorkspaceEntry } from "../types";
import { appTokens } from "../../../styles/tokens";

const addedColor = "#1a7f37";

const statusSymbols = {
	M: '<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
	A: '<path d="M5 8h6M8 5v6"/>',
	D: '<path d="M5 8h6"/>',
	R: '<path d="M5 8h6m-3-3 3 3-3 3"/>',
	C: '<path d="M6 6h5v5H6zM4 9V4h5"/>',
	U: '<path d="M8 5v4m0 2h.01"/>',
	T: '<path d="M5 5h6M8 5v6"/>',
};

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
		color: lightColors.editorInk,
		flexShrink: 0,
		maxWidth: "100%",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		overflowX: "hidden",
	},
	path: {
		...typography.xs,
		color: lightColors.editorFaint,
		minWidth: 0,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		overflowX: "hidden",
	},
});

/** Filename-first identity for changed files; the full path remains in the row's accessible label. */
export function RepositoryChangeLabel({ entry }: { entry: WorkspaceEntry }) {
	const slash = entry.title.lastIndexOf("/");
	const filename = entry.title.slice(slash + 1);
	const directory = slash < 0 ? "" : entry.title.slice(0, slash);
	const status = entry.status ?? "M";

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
							? appTokens.colors.danger
							: status === "A"
								? addedColor
								: status === "D"
									? lightColors.editorFaint
									: lightColors.brand,
				}}
			/>
			<div testId={`identity-${entry.id}`} style={styles.nameAndPath}>
				<text
					testId={`filename-${entry.id}`}
					style={StyleSheet.compose(
						styles.filename,
						status === "D" && {
							color: lightColors.editorMuted,
							textDecoration: "line-through",
						}
					)}
				>
					{filename}
				</text>
				{status === "U" ? (
					<text style={{ ...typography.xs, color: appTokens.colors.danger }}>
						Conflict
					</text>
				) : null}
				{directory ? (
					<text testId={`directory-${entry.id}`} style={styles.path}>
						{directory}
					</text>
				) : null}
			</div>
			{status === "U" ? (
				<text style={{ ...typography.xs, color: appTokens.colors.danger }}>
					Conflict
				</text>
			) : null}
		</div>
	);
}

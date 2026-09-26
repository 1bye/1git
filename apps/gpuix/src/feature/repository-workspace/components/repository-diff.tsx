import type { FileChange } from "@1git/git";
import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import type { GpuixTheme } from "@gpuix/react";
import { useState } from "react";

import { appTokens } from "../../../styles/tokens";
import { useRepositoryDiff } from "../hooks/use-repository-diff";
import {
	RepositoryDiff as DiffReader,
	type ChangeDiffTarget,
} from "../lib/repository-diff";

const diffTheme: GpuixTheme = {
	appearance: "light",
	bg: lightColors.editorSurface,
	border: lightColors.editorHairline,
	text: lightColors.editorInk,
	textMuted: lightColors.editorMuted,
	textFaint: lightColors.editorFaint,
	accent: lightColors.brand,
	diffAdd: "#568362",
	diffDel: "#b2676b",
	diffAddBg: "#f5f8f5",
	diffDelBg: "#fcf5f5",
	diffAddWordBg: "#d9e8da",
	diffDelWordBg: "#f1dadd",
	diffHunkBg: lightColors.editorSunken,
	fontMono: "Menlo",
	syntax: {
		comment: lightColors.editorFaint,
		keyword: "#75658f",
		string: "#567760",
		stringSpecial: "#567760",
		escape: "#75658f",
		number: "#976b45",
		boolean: "#976b45",
		typeName: "#516b93",
		typeBuiltin: "#516b93",
		constructor: "#516b93",
		function: "#516b93",
		functionBuiltin: "#516b93",
		macroName: "#75658f",
		property: lightColors.editorMuted,
		constant: "#976b45",
		variable: lightColors.editorInk,
		variableSpecial: lightColors.editorInk,
		parameter: lightColors.editorInk,
		operator: lightColors.editorMuted,
		punctuation: lightColors.editorMuted,
		tag: "#516b93",
		attribute: "#75658f",
		label: lightColors.editorMuted,
		invalid: "#b2676b",
	},
	metrics: {
		diffTextSize: 11,
		diffLineHeight: 20,
		diffHunkHeaderHeight: 26,
		diffRowPaddingX: 14,
		diffGutterWidth: 30,
		diffMarkerWidth: 18,
		diffAccentBarWidth: 2,
	},
};

const styles = StyleSheet.create({
	header: {
		height: 36,
		flexShrink: 0,
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingLeft: 14,
		paddingRight: 12,
		borderBottomWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	identity: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		flexGrow: 1,
		minWidth: 0,
		overflow: "hidden",
	},
	filename: {
		fontSize: 11,
		color: lightColors.editorInk,
		flexShrink: 0,
		maxWidth: "100%",
		overflow: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	directory: {
		fontSize: 10,
		color: lightColors.editorFaint,
		minWidth: 0,
		overflow: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	stats: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		flexShrink: 0,
		marginLeft: 6,
		fontSize: 10,
	},
	hint: { fontSize: 10, color: lightColors.editorFaint },
	message: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minHeight: 0,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		gap: 12,
	},
});

/** Read-only native diff with explicit index/worktree comparisons and cancellable loading. */
export function RepositoryDiff({
	root,
	change,
	refreshing,
	statusError,
	readDiff = DiffReader.read,
}: {
	root: string;
	change: FileChange;
	refreshing: boolean;
	statusError: string | null;
	readDiff?: typeof DiffReader.read;
}) {
	const { result, retry } = useRepositoryDiff(
		root,
		change,
		refreshing || !!statusError,
		readDiff
	);

	const [target, setTarget] = useState<ChangeDiffTarget>("working");

	const section =
		result?.sections.find((entry) => entry.target === target) ??
		result?.sections[0];

	const stats = section?.stats.find((entry) => entry.path === change.path);
	const slash = change.path.lastIndexOf("/");
	const filename = change.path.slice(slash + 1);
	const directory = slash < 0 ? "" : change.path.slice(0, slash);

	const message = statusError
		? "Repository status could not be refreshed. Use Refresh to try again."
		: (result?.error ?? (!result ? "Loading diff…" : null));

	return (
		<>
			<div testId="diff-header" style={styles.header}>
				<div
					testId="diff-identity"
					role="group"
					aria-label={change.path}
					style={styles.identity}
				>
					<text testId="diff-filename" style={styles.filename}>
						{filename}
					</text>
					{directory ? (
						<text testId="diff-directory" style={styles.directory}>
							{directory}
						</text>
					) : null}
				</div>
				{result && result.sections.length > 1
					? result.sections.map((entry) => (
							<Button
								key={entry.target}
								testId={`diff-${entry.target}`}
								size="sm"
								variant="ghost"
								tokens={appTokens}
								aria-label={`${entry.target === "working" ? "Unstaged" : "Staged"} changes${section?.target === entry.target ? ", selected" : ""}`}
								style={{
									height: 26,
									borderRadius: 13,
									backgroundColor:
										section?.target === entry.target
											? lightColors.editorSunken2
											: "transparent",
								}}
								textStyle={{ fontSize: 11 }}
								onPress={() => setTarget(entry.target)}
							>
								{entry.target === "working" ? "Unstaged" : "Staged"}
							</Button>
						))
					: null}
				{stats?.addedLines != null && stats.deletedLines != null ? (
					<div
						testId="diff-stats"
						role="group"
						aria-label={`${stats.addedLines} added ${stats.addedLines === 1 ? "line" : "lines"}, ${stats.deletedLines} deleted ${stats.deletedLines === 1 ? "line" : "lines"}`}
						style={styles.stats}
					>
						<text
							style={{ color: diffTheme.diffAdd }}
						>{`+${stats.addedLines}`}</text>
						<text
							style={{ color: diffTheme.diffDel }}
						>{`−${stats.deletedLines}`}</text>
					</div>
				) : null}
			</div>
			{message ? (
				<div
					testId="diff-notice"
					role={result?.error || statusError ? "alert" : "status"}
					style={styles.message}
				>
					<text style={styles.hint}>{message}</text>
					{result?.error ? (
						<Button
							testId="retry-diff"
							tokens={appTokens}
							size="sm"
							variant="secondary"
							onPress={retry}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : section?.message ? (
				<div style={styles.message} role="status">
					<text style={styles.hint}>{section.message}</text>
				</div>
			) : section ? (
				<DiffView
					key={section.target}
					testId="diff-viewport"
					patch={section.patch}
					showFileHeader={false}
					focusVisible={false}
					theme={diffTheme}
					tokens={appTokens}
					aria-label={
						section.target === "working"
							? "Unstaged file diff"
							: "Staged file diff"
					}
				/>
			) : null}
		</>
	);
}

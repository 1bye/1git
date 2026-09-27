import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import type { GpuixTheme } from "@gpuix/react";
import { useState } from "react";
import {
	RepositoryHunkPreview,
	type HunkRequest,
} from "./repository-hunk-preview";

import { appTokens } from "../../../styles/tokens";
import { RepositoryConflicts } from "../lib/repository-conflicts";
import { useRepositoryDiff } from "../hooks/use-repository-diff";
import {
	RepositoryDiff as DiffReader,
	type DiffSelection,
	type RepositoryDiffSection,
} from "../lib/repository-diff";
import {
	RepositoryImageMetadata,
	RepositoryImagePreview,
} from "./repository-image-preview";

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
	onResolve,
	onHunk,
	openConflictEditor = RepositoryConflicts.openEditor,
}: {
	root: string;
	change: DiffSelection;
	refreshing: boolean;
	statusError: string | null;
	readDiff?: typeof DiffReader.read;
	onHunk?: (request: HunkRequest) => Promise<string | null>;
	onResolve?: (
		hash: string,
		side?: "ours" | "theirs"
	) => Promise<string | null>;
	openConflictEditor?: typeof RepositoryConflicts.openEditor;
}) {
	const { result, retry } = useRepositoryDiff(
		root,
		change,
		refreshing || !!statusError,
		readDiff
	);

	const [target, setTarget] =
		useState<RepositoryDiffSection["target"]>("working");

	const [sourcePath, setSourcePath] = useState<string | null>(null);
	const [conflictError, setConflictError] = useState<string | null>(null);

	const [resolutionSide, setResolutionSide] = useState<
		"ours" | "theirs" | null
	>(null);

	const [acting, setActing] = useState(false);
	const conflicted = "recordType" in change && change.recordType === "unmerged";

	const section =
		result?.sections.find((entry) => entry.target === target) ??
		result?.sections[0];

	const stats = section?.stats.find((entry) => entry.path === change.path);
	const showSource = section?.image?.svg && sourcePath === change.path;
	const showImage = section?.image && !showSource;
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
				{section?.image?.svg
					? (["Preview", "Source"] as const).map((mode) => (
							<Button
								key={mode}
								testId={`image-mode-${mode.toLowerCase()}`}
								size="sm"
								variant="ghost"
								tokens={appTokens}
								aria-label={`${mode} SVG${(mode === "Source") === !!showSource ? ", selected" : ""}`}
								style={{
									height: 26,
									borderRadius: 13,
									backgroundColor:
										(mode === "Source") === !!showSource
											? lightColors.editorSunken2
											: "transparent",
								}}
								textStyle={{ fontSize: 11 }}
								onPress={() =>
									setSourcePath(mode === "Source" ? change.path : null)
								}
							>
								{mode}
							</Button>
						))
					: null}
				{showImage && section?.image ? (
					<RepositoryImageMetadata comparison={section.image} />
				) : null}
				{!showImage &&
				stats?.addedLines != null &&
				stats.deletedLines != null ? (
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
			{conflicted ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexShrink: 0,
						padding: 10,
						gap: 6,
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 6,
						}}
					>
						<text
							style={{
								...styles.hint,
								color: appTokens.colors.danger,
								flexGrow: 1,
							}}
						>
							Conflict · Working file
						</text>
						<Button
							testId="conflict-open-editor"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							disabled={refreshing || acting || !!statusError}
							onPress={async () => {
								setActing(true);
								setConflictError(null);

								try {
									await openConflictEditor(root, change.path);
								} catch (error) {
									setConflictError(
										error instanceof Error
											? error.message
											: "Could not open the text editor."
									);
								} finally {
									setActing(false);
								}
							}}
						>
							Open in editor
						</Button>
						<Button
							testId="conflict-refresh"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							disabled={refreshing || acting || !!statusError}
							onPress={retry}
						>
							Refresh preview
						</Button>
						<Button
							testId="conflict-resolve"
							tokens={appTokens}
							size="sm"
							disabled={
								refreshing ||
								acting ||
								!!statusError ||
								!section?.conflict ||
								!onResolve
							}
							onPress={async () => {
								if (!section?.conflict || !onResolve || acting) return;

								setActing(true);
								setConflictError(null);

								try {
									setConflictError(await onResolve(section.conflict.hash));
								} catch {
									setConflictError(
										"Could not confirm resolution. Refresh before retrying."
									);
								} finally {
									setActing(false);
								}
							}}
						>
							Mark resolved
						</Button>
					</div>
					<div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
						{(["ours", "theirs"] as const).map((side) => (
							<Button
								key={side}
								testId={`conflict-use-${side}`}
								tokens={appTokens}
								size="sm"
								variant="secondary"
								disabled={
									refreshing ||
									acting ||
									!!statusError ||
									!section?.conflict ||
									!onResolve
								}
								onPress={() => setResolutionSide(side)}
							>
								Use {side}
							</Button>
						))}
					</div>
					{resolutionSide ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<text style={styles.hint}>
								Replace the whole file with {resolutionSide} and stage it?
								Current edits to this file will be lost.
							</text>
							<text style={styles.hint}>
								During rebase, ours is the branch being rebased onto; theirs is
								the commit being replayed.
							</text>
							<div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
								<Button
									tokens={appTokens}
									size="sm"
									variant="secondary"
									disabled={acting}
									onPress={() => setResolutionSide(null)}
								>
									Cancel
								</Button>
								<Button
									testId="conflict-confirm-side"
									tokens={appTokens}
									size="sm"
									disabled={
										refreshing ||
										acting ||
										!!statusError ||
										!section?.conflict ||
										!onResolve
									}
									onPress={async () => {
										if (!section?.conflict || !onResolve || acting) return;

										setActing(true);
										setConflictError(null);

										try {
											const error = await onResolve(
												section.conflict.hash,
												resolutionSide
											);

											setConflictError(error);

											if (!error) setResolutionSide(null);
										} catch {
											setConflictError(
												"Could not confirm resolution. Refresh before retrying."
											);
										} finally {
											setActing(false);
										}
									}}
								>
									Replace and stage
								</Button>
							</div>
						</div>
					) : null}
					<text style={styles.hint}>
						Edit and save the file, then refresh and review. Mark resolved
						stages this file; it does not commit or continue a merge/rebase.
					</text>
					{conflictError ? (
						<text
							testId="conflict-error"
							role="alert"
							style={{ ...styles.hint, color: appTokens.colors.danger }}
						>
							{conflictError}
						</text>
					) : null}
				</div>
			) : null}
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
			) : section?.conflict ? (
				<textarea
					testId="conflict-content"
					aria-label="Conflicted working file, read only"
					value={section.conflict.text}
					readOnly
					tabIndex={0}
					style={{
						flexGrow: 1,
						minHeight: 0,
						fontFamily: "Menlo",
						fontSize: 11,
						lineHeight: 20,
						padding: 14,
						color: appTokens.colors.text,
						backgroundColor: appTokens.colors.field,
					}}
				/>
			) : showImage && section?.image ? (
				<RepositoryImagePreview comparison={section.image} path={change.path} />
			) : section?.message ? (
				<div style={styles.message} role="status">
					<text style={styles.hint}>{section.message}</text>
				</div>
			) : section &&
			  onHunk &&
			  section.target !== "commit" &&
			  "recordType" in change &&
			  change.recordType === "ordinary" &&
			  section.patch.includes("\n@@ ") ? (
				<RepositoryHunkPreview
					key={`${section.target}:${section.patch}`}
					action={section.target === "working" ? "stage" : "unstage"}
					onHunk={onHunk}
					disabled={refreshing || acting || !!statusError}
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
						section.target === "commit"
							? "Committed file diff"
							: section.target === "working"
								? "Unstaged file diff"
								: "Staged file diff"
					}
				/>
			) : null}
		</>
	);
}

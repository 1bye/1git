import { repositoryDiffTheme } from "../lib/repository-diff-theme";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, radius } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { useState } from "react";

import { StateMessage } from "../../../fixture/state-message";
import { RepositoryConflicts } from "../lib/repository-conflicts";
import {
	useRepositoryDiff,
	type RepositoryPreviewResult,
} from "../hooks/use-repository-diff";
import type { RepositoryPreviewCache } from "../lib/repository-preview-cache";
import type { WorkspaceEntry } from "../types";
import {
	RepositoryDiff as DiffReader,
	type DiffSelection,
	type DiffSettings,
	defaultDiffSettings,
} from "../lib/repository-diff";
import {
	RepositoryImageMetadata,
	RepositoryImagePreview,
} from "./repository-image-preview";
import { RepositoryTextDiff, type DiffInclusion } from "./repository-text-diff";
import { RepositoryDiffSettings } from "./repository-diff-settings";

const themedStyles = createThemedStyles((theme) => {
	const { colors: appColors } = theme;

	const diffTheme = repositoryDiffTheme.get(theme);

	const styles = StyleSheet.create({
		header: {
			height: 36,
			flexShrink: 0,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
			paddingLeft: spacing[3.5],
			paddingRight: spacing[3],
			borderBottomWidth: 1,
			borderColor: appColors.editorHairline,
		},
		identity: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
			flexGrow: 1,
			minWidth: 0,
			overflow: "hidden",
		},
		filename: {
			...typography.sm,
			color: appColors.editorInk,
			flexShrink: 0,
			maxWidth: "100%",
			overflow: "hidden",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
		},
		directory: {
			...typography.xs,
			color: appColors.editorFaint,
			minWidth: 0,
			overflow: "hidden",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
		},
		stats: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
			flexShrink: 0,
			marginLeft: spacing[1.5],
			...typography.xs,
		},
		hint: { ...typography.xs, color: appColors.editorFaint },
	});

	return { diffTheme, styles };
});

interface RepositoryDiffProps {
	inclusion?: DiffInclusion;
	root: string;
	change: DiffSelection;
	refreshing: boolean;
	statusError: string | null;
	readDiff?: typeof DiffReader.read;
	cache?: RepositoryPreviewCache;
	version?: object;
	files?: readonly WorkspaceEntry[];
	onResolve?: (
		hash: string,
		side?: "ours" | "theirs"
	) => Promise<string | null>;
	openConflictEditor?: typeof RepositoryConflicts.openEditor;
	settings?: DiffSettings;
	onSettingsChange?: (settings: DiffSettings) => void;
}

/** Read-only preview that swaps ready content atomically and never flashes a loader for a fast read. */
export function RepositoryDiff(props: RepositoryDiffProps) {
	const [localSettings, setLocalSettings] = useState(defaultDiffSettings);
	const settings = props.settings ?? localSettings;
	const onSettingsChange = props.onSettingsChange ?? setLocalSettings;

	const {
		root,
		change,
		refreshing,
		statusError,
		readDiff = DiffReader.read,
		cache,
		version,
		files,
	} = props;

	const { result, retry, pending, slow } = useRepositoryDiff(
		root,
		change,
		refreshing || !!statusError,
		readDiff,
		cache,
		version,
		files,
		settings.ignoreWhitespace
	);

	const displayed = result?.change ?? change;

	const identity = JSON.stringify([
		root,
		displayed.path,
		"commit" in displayed ? [displayed.commit, displayed.base] : null,
	]);

	return (
		<RepositoryDiffContent
			key={identity}
			{...props}
			settings={settings}
			onSettingsChange={onSettingsChange}
			change={displayed}
			result={result}
			refreshing={refreshing || pending}
			onResolve={pending ? undefined : props.onResolve}
			retry={retry}
			slow={slow}
		/>
	);
}

function RepositoryDiffContent({
	root,
	change,
	refreshing,
	statusError,
	onResolve,
	openConflictEditor = RepositoryConflicts.openEditor,
	result,
	retry,
	slow,
	settings = defaultDiffSettings,
	onSettingsChange,
	inclusion,
}: RepositoryDiffProps & {
	result: RepositoryPreviewResult | null;
	retry: () => void;
	slow: boolean;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { diffTheme, styles } = themedStyles.get(theme);

	const [sourcePath, setSourcePath] = useState<string | null>(null);
	const [conflictError, setConflictError] = useState<string | null>(null);

	const [resolutionSide, setResolutionSide] = useState<
		"ours" | "theirs" | null
	>(null);

	const [acting, setActing] = useState(false);
	const conflicted = "recordType" in change && change.recordType === "unmerged";

	const section = result?.sections[0];

	const stats = section?.stats.find((entry) => entry.path === change.path);
	const showSource = section?.image?.svg && sourcePath === change.path;
	const showImage = section?.image && !showSource;
	const slash = change.path.lastIndexOf("/");
	const filename = change.path.slice(slash + 1);
	const directory = slash < 0 ? "" : change.path.slice(0, slash);

	const message = statusError
		? "Repository status could not be refreshed. Use Refresh to try again."
		: (result?.error ?? (!result && slow ? "Loading diff…" : null));

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
				{slow && result?.sections.length ? (
					<text testId="diff-progress" role="status" style={styles.hint}>
						Opening preview…
					</text>
				) : null}
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
									borderRadius: radius.full,
									backgroundColor:
										(mode === "Source") === !!showSource
											? appColors.editorSunken2
											: "transparent",
								}}
								textStyle={{ ...typography.sm }}
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
							style={{ color: appColors.success }}
						>{`+${stats.addedLines}`}</text>
						<text
							style={{ color: appColors.deletion }}
						>{`−${stats.deletedLines}`}</text>
					</div>
				) : null}
				{!conflicted && !showImage && onSettingsChange ? (
					<RepositoryDiffSettings
						settings={settings}
						onChange={onSettingsChange}
					/>
				) : null}
			</div>
			{conflicted ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexShrink: 0,
						padding: spacing[2.5],
						gap: spacing[1.5],
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: spacing[1.5],
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
					<div
						style={{ display: "flex", flexDirection: "row", gap: spacing[1.5] }}
					>
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
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[1.5],
							}}
						>
							<text style={styles.hint}>
								Replace the whole file with {resolutionSide} and mark it
								resolved? Current edits to this file will be lost.
							</text>
							<text style={styles.hint}>
								During rebase, ours is the branch being rebased onto; theirs is
								the commit being replayed.
							</text>
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									gap: spacing[1.5],
								}}
							>
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
									Replace and resolve
								</Button>
							</div>
						</div>
					) : null}
					<text style={styles.hint}>
						Edit and save the file, then refresh and review. Mark resolved
						confirms this file’s resolution; it does not commit or continue a
						merge/rebase.
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
				<StateMessage
					testId="diff-notice"
					role={result?.error || statusError ? "alert" : "status"}
					artwork={result?.error || statusError ? "error" : "loading"}
					title={message}
				>
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
				</StateMessage>
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
						fontFamily: theme.typography?.codeFontFamily || "Menlo",
						...typography.sm,
						lineHeight: typography.lg.lineHeight,
						padding: spacing[3.5],
						color: appTokens.colors.text,
						backgroundColor: appTokens.colors.field,
					}}
				/>
			) : showImage && section?.image ? (
				<RepositoryImagePreview comparison={section.image} path={change.path} />
			) : section?.message ? (
				<StateMessage artwork="unavailable" title={section.message} />
			) : section ? (
				<RepositoryTextDiff
					key={section.target}
					root={root}
					change={change}
					snapshot={result?.sections ?? section}
					patch={section.patch}
					syntaxPatch={section.syntaxPatch}
					theme={diffTheme}
					blocked={refreshing}
					inclusion={inclusion}
					onShowWhitespace={() =>
						onSettingsChange?.({ ...settings, ignoreWhitespace: false })
					}
					mode={settings.mode}
					splitLayout={settings.splitLayout}
					ignoreWhitespace={
						result?.ignoreWhitespace ?? settings.ignoreWhitespace
					}
				/>
			) : null}
		</>
	);
}

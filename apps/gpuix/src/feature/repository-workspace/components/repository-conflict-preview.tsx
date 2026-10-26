import { useMemo, useRef, useState } from "react";
import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { Text } from "@1git/gpuix-ui/text";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import { useAppTheme } from "../../../styles/theme";
import {
	RepositoryConflicts,
	type ConflictPreview,
} from "../lib/repository-conflicts";
import { repositoryConflictTheme } from "../lib/repository-conflict-theme";
import { repositoryDiffTheme } from "../lib/repository-diff-theme";
import { diffLimits } from "../lib/repository-diff";
import { DiffContext } from "../lib/diff-context";
import { ConflictPreviewModel } from "../lib/conflict-preview";

/** A single native list aligns both versions; context expansion uses the already-read text. */
function ConflictComparisonView({
	path,
	source,
	result,
	disabled,
}: {
	path: string;
	source: string | null | undefined;
	result: string;
	disabled: boolean;
}) {
	const theme = useAppTheme();

	const comparison = useMemo(() => {
		const compact = ConflictPreviewModel.compare(path, source, result);

		const full = compact.message
			? compact
			: ConflictPreviewModel.compare(path, source, result, diffLimits.lines);

		return { ...compact, syntaxPatch: full.patch || undefined };
	}, [path, source, result]);

	const [expanded, setExpanded] = useState<{
		comparison: typeof comparison;
		patch: string;
		endReached: boolean;
	} | null>(null);

	const [failure, setFailure] = useState<{
		comparison: typeof comparison;
		message: string;
	} | null>(null);

	const patch =
		expanded?.comparison === comparison ? expanded.patch : comparison.patch;

	const expandAfter =
		!(expanded?.comparison === comparison && expanded.endReached) &&
		DiffContext.hasAfter(patch, comparison.syntaxPatch);

	const expand = (oldLine?: number, newLine?: number, after = false): void => {
		if (disabled) return;

		try {
			const request = DiffContext.request(patch, oldLine, newLine, after);

			if (!request) return;

			const candidate =
				comparison.syntaxPatch ??
				ConflictPreviewModel.compare(path, source, result, request.contextLines)
					.patch;

			if (!candidate)
				throw new Error(
					"More context exceeds the preview limit. Open the file in your editor."
				);

			const next = DiffContext.expand(patch, candidate, request);

			setExpanded({ comparison, ...next });
			setFailure(null);
		} catch (cause) {
			setFailure({
				comparison,
				message:
					cause instanceof Error
						? cause.message
						: "Could not expand this context.",
			});
		}
	};

	if (comparison.message)
		return (
			<Text
				testId="conflict-comparison-notice"
				tokens={theme.tokens}
				tone="muted"
				size="sm"
				style={{ padding: spacing[3], flexGrow: 1, whiteSpace: "normal" }}
			>
				{comparison.message}
			</Text>
		);

	return (
		<>
			<DiffView
				testId="conflict-content"
				patch={patch}
				syntaxPatch={comparison.syntaxPatch}
				mode="split"
				splitLayout="fixed"
				showFileHeader={false}
				focusVisible={false}
				selectionEnabled={false}
				expandAfter={expandAfter && !disabled}
				theme={repositoryDiffTheme.get(theme)}
				tokens={theme.tokens}
				aria-label="Indexed version compared with working result"
				aria-description="Read-only. Indexed version on the left, working result on the right. Both columns share vertical scrolling. Conflict markers remain in the working result. Click a hunk header to reveal more context. Use arrows, Page Up, Page Down, Home and End to scroll."
				onExpandContext={(event) =>
					expand(event.oldLine, event.newLine, event.value === "after")
				}
			/>
			{failure?.comparison === comparison ? (
				<Text
					testId="conflict-context-error"
					tokens={theme.tokens}
					tone="danger"
					size="sm"
					role="alert"
					style={{ padding: spacing[2], whiteSpace: "normal" }}
				>
					{failure.message}
				</Text>
			) : null}
		</>
	);
}

interface VersionChoice {
	kind: "ours" | "theirs";
	hash: string;
	revision: string;
	label: string;
}

/** Compare an indexed source against the working file without changing it; replacement stays explicit. */
export function RepositoryConflictPreview({
	root,
	path,
	preview,
	message,
	disabled,
	onResolve,
	openEditor = RepositoryConflicts.openEditor,
	onRefresh,
}: {
	root: string;
	path: string;
	preview?: ConflictPreview;
	message?: string | null;
	disabled: boolean;
	onResolve?: (
		hash: string,
		side?: "ours" | "theirs",
		expectedSideOid?: string
	) => Promise<string | null>;
	openEditor?: typeof RepositoryConflicts.openEditor;
	onRefresh: () => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const palette = repositoryConflictTheme.get(theme);
	const [compared, setCompared] = useState<"ours" | "theirs">("ours");
	const [acting, setActing] = useState(false);
	const [choice, setChoice] = useState<VersionChoice | null>(null);
	const [error, setError] = useState<string | null>(null);

	const markers = useMemo(
		() => ConflictPreviewModel.markers(preview?.text ?? ""),
		[preview?.text]
	);

	const busy = disabled || acting;
	const starting = useRef(false);
	const source = preview?.[compared];

	const title =
		source?.label ??
		(compared === "ours" ? "Current version" : "Incoming version");

	const tone = compared === "ours" ? palette.current : palette.incoming;

	const edit = async (): Promise<void> => {
		if (busy || starting.current) return;

		starting.current = true;
		setActing(true);
		setError(null);

		try {
			await openEditor(root, path);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not open the editor."
			);
		} finally {
			starting.current = false;
			setActing(false);
		}
	};

	const resolve = async (replacement?: VersionChoice): Promise<void> => {
		if (
			!preview ||
			!onResolve ||
			busy ||
			starting.current ||
			(!replacement && markers.unresolved)
		)
			return;

		starting.current = true;
		setActing(true);
		setError(null);

		try {
			const failure = replacement
				? await onResolve(
						replacement.hash,
						replacement.kind,
						replacement.revision
					)
				: await onResolve(preview.hash);

			setError(failure);

			if (!failure) setChoice(null);
		} catch {
			setError("Could not confirm resolution. Refresh before retrying.");
		} finally {
			starting.current = false;
			setActing(false);
		}
	};

	return (
		<div
			testId="conflict-preview"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
				overflow: "hidden",
			}}
		>
			<div
				testId="conflict-toolbar"
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: spacing[1.5],
					padding: spacing[2],
					flexShrink: 0,
					borderBottomWidth: 1,
					borderColor: tokens.colors.border,
				}}
			>
				{preview ? (
					<div
						role="group"
						aria-label="Compare indexed version with working result"
						style={{
							display: "flex",
							flexDirection: "row",
							gap: spacing[1],
							flexGrow: 1,
						}}
					>
						{(["ours", "theirs"] as const).map((kind) => (
							<Button
								key={kind}
								testId={`conflict-compare-${kind}`}
								tokens={tokens}
								size="sm"
								variant="ghost"
								disabled={busy}
								aria-label={`Compare ${preview[kind]?.label ?? kind} with working result`}
								aria-pressed={compared === kind}
								style={{
									backgroundColor:
										compared === kind
											? kind === "ours"
												? palette.current.wash
												: palette.incoming.wash
											: "transparent",
								}}
								onPress={() => setCompared(kind)}
							>
								{preview[kind]?.label.split(" · ")[0] ??
									(kind === "ours" ? "Current" : "Incoming")}
							</Button>
						))}
					</div>
				) : null}
				<Button
					testId="conflict-open-editor"
					tokens={tokens}
					size="sm"
					variant="secondary"
					disabled={busy}
					onPress={edit}
				>
					Open editor
				</Button>
				<Button
					testId="conflict-refresh"
					tokens={tokens}
					size="sm"
					variant="ghost"
					disabled={busy}
					onPress={onRefresh}
				>
					Refresh
				</Button>
				{preview ? (
					<Button
						testId="conflict-resolve"
						tokens={tokens}
						size="sm"
						disabled={busy || !onResolve || markers.unresolved}
						aria-description={
							markers.unresolved
								? "Resolve the remaining conflict markers, save, then refresh."
								: "Stage this reviewed result without continuing the operation."
						}
						onPress={() => {
							void resolve();
						}}
					>
						Mark resolved
					</Button>
				) : null}
			</div>
			{preview ? (
				<>
					<div
						testId="conflict-columns"
						style={{
							display: "flex",
							flexDirection: "row",
							flexShrink: 0,
							borderBottomWidth: 1,
							borderColor: tokens.colors.border,
						}}
					>
						<div
							testId="conflict-source-header"
							role="group"
							aria-label={title}
							aria-description={source?.description}
							style={{
								width: "50%",
								minWidth: 0,
								display: "flex",
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: spacing[1],
								padding: spacing[2],
								backgroundColor: tone.wash,
								borderRightWidth: 1,
								borderColor: tokens.colors.border,
							}}
						>
							<Text
								tokens={tokens}
								size="sm"
								weight="medium"
								style={{
									color: tone.ink,
									flexGrow: 1,
									minWidth: 0,
									whiteSpace: "nowrap",
									textOverflow: "ellipsis",
									overflow: "hidden",
								}}
							>
								{title}
							</Text>
							<Popover
								open={choice !== null}
								onOpenChange={(open) => {
									if (busy) return;

									setError(null);
									setChoice(
										open && source?.revision && preview
											? {
													kind: compared,
													hash: preview.hash,
													revision: source.revision,
													label: title,
												}
											: null
									);
								}}
							>
								<PopoverTrigger asChild>
									<Button
										testId={`conflict-use-${compared}`}
										tokens={tokens}
										size="sm"
										variant="ghost"
										aria-label={`Use ${title} for the whole file`}
										disabled={
											busy ||
											!onResolve ||
											!source?.revision ||
											source.text == null
										}
									>
										Use this version…
									</Button>
								</PopoverTrigger>
								<PopoverContent
									tokens={tokens}
									aria-label="Confirm whole-file replacement"
									side="bottom"
									width={320}
									dismissible={!busy}
								>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[2],
										}}
									>
										<Text tokens={tokens} weight="medium">
											Use {choice?.label}?
										</Text>
										<Text tokens={tokens} size="sm">
											Replace the whole file and mark it resolved? Current edits
											to this file will be lost.
										</Text>
										<div
											style={{
												display: "flex",
												flexDirection: "row",
												justifyContent: "flex-end",
												gap: spacing[2],
											}}
										>
											<Button
												testId="conflict-cancel-side"
												tokens={tokens}
												variant="secondary"
												size="sm"
												disabled={busy}
												onPress={() => setChoice(null)}
											>
												Cancel
											</Button>
											<Button
												testId="conflict-confirm-side"
												tokens={tokens}
												size="sm"
												disabled={busy || !choice}
												onPress={() => {
													if (choice) void resolve(choice);
												}}
											>
												Replace and resolve
											</Button>
										</div>
										{error ? (
											<Text
												testId="conflict-error"
												tokens={tokens}
												tone="danger"
												role="alert"
												size="sm"
											>
												{error}
											</Text>
										) : null}
									</div>
								</PopoverContent>
							</Popover>
						</div>
						<div
							testId="conflict-result-header"
							style={{
								width: "50%",
								minWidth: 0,
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
								padding: spacing[2],
								backgroundColor: markers.unresolved
									? palette.warning.wash
									: theme.colors.editorSunken,
							}}
						>
							<Text
								tokens={tokens}
								size="sm"
								weight="medium"
								style={{
									color: markers.unresolved
										? palette.warning.ink
										: tokens.colors.text,
								}}
							>
								Working result
							</Text>
							<Text
								testId="conflict-block-count"
								tokens={tokens}
								size="xs"
								tone="muted"
							>
								{markers.unresolved
									? markers.starts.length
										? `${markers.starts.length} conflict ${markers.starts.length === 1 ? "block" : "blocks"} · unresolved`
										: "Unresolved markers remain"
									: "Ready to mark resolved"}
							</Text>
						</div>
					</div>
					<ConflictComparisonView
						path={path}
						source={source?.text}
						result={preview.text}
						disabled={busy}
					/>
				</>
			) : (
				<Text
					tokens={tokens}
					size="sm"
					style={{ padding: spacing[3], flexGrow: 1 }}
				>
					{message ?? "Loading conflict versions…"}
				</Text>
			)}
			<div
				style={{
					padding: spacing[2],
					flexShrink: 0,
					borderTopWidth: 1,
					borderColor: tokens.colors.border,
				}}
			>
				<Text
					tokens={tokens}
					size="xs"
					tone="muted"
					style={{ minWidth: 0, whiteSpace: "normal" }}
				>
					{!preview || markers.unresolved
						? "Save edits in your editor, then Refresh."
						: "Mark resolved stages the file. Continue separately."}
				</Text>
			</div>
			{error && !choice ? (
				<Text
					testId="conflict-error"
					tokens={tokens}
					size="sm"
					role="alert"
					style={{
						padding: spacing[2],
						color: tokens.colors.danger,
						whiteSpace: "normal",
					}}
				>
					{error}
				</Text>
			) : null}
		</div>
	);
}

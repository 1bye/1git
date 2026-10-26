import { useAppTheme } from "../../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { useGpuixRequired, type GpuixTheme } from "@gpuix/react";
import { PartialPatch } from "@1git/git";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DiffContext } from "../lib/diff-context";
import { Keybinds } from "../../keybinds/keybinds";
import { useKeybinds } from "../../keybinds/keybind-context";
import { RepositoryDiff, type DiffSelection } from "../lib/repository-diff";

export interface DiffInclusion {
	readonly included: boolean;
	readonly selection?: {
		readonly expectedPatch: string;
		readonly includedLines: readonly string[];
	};
	readonly onChange: (
		patch: string,
		includedLines: readonly string[],
		total: number
	) => void;
}

/** Owns one displayed snapshot's on-demand context; never replaces the diff with a loader. */
export function RepositoryTextDiff({
	root,
	change,
	snapshot,
	patch,
	syntaxPatch,
	theme,
	blocked,
	mode,
	splitLayout,
	ignoreWhitespace,
	inclusion,
	onShowWhitespace,
}: {
	root: string;
	change: DiffSelection;
	snapshot: object;
	patch: string;
	syntaxPatch?: string;
	theme: GpuixTheme;
	blocked: boolean;
	mode: "unified" | "split";
	splitLayout: "fixed" | "content-sized";
	ignoreWhitespace: boolean;
	inclusion?: DiffInclusion;
	onShowWhitespace: () => void;
}) {
	const { tokens: appTokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const { overrides } = useKeybinds();

	const inclusionEnabled = !!inclusion;

	const selectablePatch = useMemo(() => {
		if (!inclusionEnabled) return null;

		try {
			return new PartialPatch(patch);
		} catch {
			return null;
		}
	}, [patch, inclusionEnabled]);

	const stale =
		!ignoreWhitespace &&
		inclusion?.selection &&
		inclusion.selection.expectedPatch !== patch;

	const includedLines = inclusion?.selection
		? stale
			? []
			: inclusion.selection.includedLines
		: inclusion?.included
			? (selectablePatch?.lines ?? [])
			: [];

	const [expanded, setExpanded] = useState({
		snapshot,
		patch,
		endReached: false,
	});

	const [whitespacePrompt, setWhitespacePrompt] = useState<object | null>(null);

	const [failure, setFailure] = useState<{
		snapshot: object;
		message: string;
	} | null>(null);

	const pending = useRef<AbortController | null>(null);
	const displayed = expanded.snapshot === snapshot ? expanded.patch : patch;
	const endReached = expanded.snapshot === snapshot && expanded.endReached;

	const hasAfter = useMemo(
		() => DiffContext.hasAfter(displayed, syntaxPatch),
		[displayed, syntaxPatch]
	);

	const expandAfter = !endReached && hasAfter;
	const error = failure?.snapshot === snapshot ? failure.message : null;

	const inclusionInstructions = !selectablePatch
		? "Read-only. "
		: ignoreWhitespace
			? "Activate the inclusion gutter to show whitespace changes before selecting lines. "
			: "Toggle the inclusion gutter with a click, or Tab then Space. ";

	// Reset only context, not the native viewport, so status refresh preserves scroll.
	useLayoutEffect(
		() => () => {
			pending.current?.abort();
			pending.current = null;
		},
		[snapshot]
	);
	useEffect(() => {
		if (blocked) {
			pending.current?.abort();
			pending.current = null;
		}
	}, [blocked]);

	const expand = async (
		oldLine?: number,
		newLine?: number,
		after = false
	): Promise<void> => {
		if (blocked || pending.current) return;

		const controller = new AbortController();

		pending.current = controller;
		setFailure(null);

		try {
			const request = DiffContext.request(displayed, oldLine, newLine, after);

			if (!request || (request.after && !expandAfter)) return;

			const source = await RepositoryDiff.readContext(
				root,
				change,
				request.contextLines,
				controller.signal,
				ignoreWhitespace
			);

			if (!controller.signal.aborted) {
				const result = DiffContext.expand(displayed, source, request);

				setExpanded({
					snapshot,
					patch: result.patch,
					endReached: request.after ? result.endReached : endReached,
				});
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				setFailure({
					snapshot,
					message:
						cause instanceof Error
							? cause.message
							: "Unable to expand diff context.",
				});
		} finally {
			if (pending.current === controller) pending.current = null;
		}
	};

	return (
		<>
			<DiffView
				testId="diff-viewport"
				patch={displayed}
				expandAfter={expandAfter && !blocked}
				syntaxPatch={syntaxPatch}
				selectionEnabled={!!selectablePatch}
				selectionDisabled={blocked}
				includedLines={includedLines}
				onToggleChange={
					selectablePatch && inclusion
						? (event) => {
								if (blocked || !event.value) return;

								if (ignoreWhitespace) {
									setWhitespacePrompt(snapshot);

									return;
								}

								const keys: unknown = JSON.parse(event.value);

								if (
									!Array.isArray(keys) ||
									!keys.every(
										(key): key is string =>
											typeof key === "string" &&
											selectablePatch.lines.includes(key)
									)
								)
									return;

								const selected = new Set(includedLines);
								const exclude = keys.every((key) => selected.has(key));

								for (const key of keys) {
									if (exclude) selected.delete(key);
									else selected.add(key);
								}

								inclusion.onChange(
									patch,
									[...selected],
									selectablePatch.lines.length
								);
							}
						: undefined
				}
				mode={mode}
				splitLayout={splitLayout}
				showFileHeader={false}
				focusVisible={false}
				theme={theme}
				tokens={appTokens}
				aria-label={"commit" in change ? "Committed file diff" : "File diff"}
				aria-description={`${mode === "split" ? "Split: original on the left, revised on the right. " : "Unified. "}${inclusionInstructions}Use arrows, Page Up, Page Down, Home and End to scroll. Press ${Keybinds.label("expand-diff", overrides)} to expand 20 unchanged lines at the first remaining separator or below the final change. Select text and press Command C to copy.`}
				onExpandContext={(event) => {
					void expand(event.oldLine, event.newLine, event.value === "after");
				}}
				onShortcut={(event) => {
					if (!Keybinds.matches(event, "expand-diff", renderer)) return false;

					void expand();

					return true;
				}}
			/>
			<Popover
				open={
					whitespacePrompt === snapshot &&
					ignoreWhitespace &&
					!blocked &&
					!!inclusion
				}
				onOpenChange={(open) => {
					if (!open) setWhitespacePrompt(null);
				}}
			>
				<PopoverContent
					placement="center"
					width={340}
					testId="diff-whitespace-prompt"
					aria-label="Show whitespace changes?"
					tokens={appTokens}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[2],
						}}
					>
						<text
							role="heading"
							aria-level={2}
							style={{ ...typography.lg, color: appTokens.colors.text }}
						>
							Show whitespace changes?
						</text>
						<text
							style={{ ...typography.sm, color: appTokens.colors.textMuted }}
						>
							Line selection is unavailable while whitespace changes are hidden.
						</text>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								justifyContent: "flex-end",
								gap: spacing[1],
							}}
						>
							<Button
								testId="diff-whitespace-cancel"
								tokens={appTokens}
								size="sm"
								variant="secondary"
								onPress={() => setWhitespacePrompt(null)}
							>
								Cancel
							</Button>
							<Button
								testId="diff-whitespace-confirm"
								tokens={appTokens}
								size="sm"
								onPress={() => {
									setWhitespacePrompt(null);
									onShowWhitespace();
								}}
							>
								Show whitespace changes
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
			{inclusion && (stale || !selectablePatch) ? (
				<text
					role="status"
					style={{
						...typography.xs,
						color: appTokens.colors.textMuted,
						padding: spacing[1.5],
					}}
				>
					{stale
						? "This file changed. Review its line selection again before committing."
						: "This change uses whole-file inclusion."}
				</text>
			) : null}
			{error ? (
				<text
					testId="diff-context-status"
					role="alert"
					style={{
						flexShrink: 0,
						paddingLeft: spacing[3.5],
						paddingRight: spacing[3.5],
						paddingTop: spacing[1.5],
						paddingBottom: spacing[1.5],
						...typography.sm,
						color: appTokens.colors.danger,
					}}
				>
					{error}
				</text>
			) : null}
		</>
	);
}

import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { RepositoryLastCommit } from "./repository-last-commit";
import { Keybinds } from "../../keybinds/keybinds";
import { useKeybinds } from "../../keybinds/keybind-context";
import { RepositoryCommitProcess } from "./repository-commit-process";
import { commitTypeColor } from "./commit-type-colors";
import { CommitSubject } from "../lib/commit-subject";
import {
	AiCommitButton,
	AiCommitProgress,
	AiCommitStatus,
} from "../../ai/ai-commit-button";
import { useAiCommit } from "../../ai/use-ai-commit";
import type { CommitRecoveryInput } from "@1git/git";
import type { RepositoryCommit as CommitReader } from "../lib/repository-commit";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

const bodySeparator = /\r?\n[ \t]*\r?\n/;

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const actionInset = spacing[2.5];
	const actionHeight = 24;
	const actionClearance = actionInset + actionHeight + spacing[2];
	const surface = Bun.color(appColors.editorSurface, "{rgba}");

	const styles = StyleSheet.create({
		composer: {
			display: "flex",
			flexDirection: "column",
			flexShrink: 0,
			borderTopWidth: 1,
			borderColor: appColors.editorHairline,
		},
		editorSurface: {
			position: "relative",
			height: 140,
			flexShrink: 0,
		},
		editor: {
			width: "100%",
			height: "100%",
			padding: spacing[2],
			...typography.sm,
			backgroundColor: "transparent",
			borderWidth: 0,
			borderColor: "transparent",
		},
		fade: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			height: actionClearance,
			pointerEvents: "none",
			background: {
				type: "linear-gradient",
				angle: 180,
				stops: [
					{
						color: surface
							? `rgba(${surface.r}, ${surface.g}, ${surface.b}, 0)`
							: "transparent",
						position: 0,
					},
					{ color: appColors.editorSurface, position: 0.8 },
				],
			},
		},
		actions: {
			position: "absolute",
			right: actionInset,
			bottom: actionInset,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
			height: actionHeight,
			userSelect: "none",
		},
		hint: { ...typography["2xs"], color: appColors.editorFaint },
		notice: {
			display: "flex",
			flexDirection: "column",
			gap: spacing[1],
			maxHeight: 64,
			marginLeft: spacing[2.5],
			marginRight: spacing[2.5],
			marginTop: spacing[1.5],
			marginBottom: spacing[1.5],
			flexShrink: 0,
			overflowY: "scroll",
			overflowX: "hidden",
			borderWidth: 1,
			borderColor: "transparent",
		},
		label: { ...typography.sm, fontWeight: fontWeight.medium },
	});

	return { styles, scrollPaddingBottom: actionClearance - spacing[2] };
});

/** Selected-change commit/amend composer; only explicit sample mode remains preview-only. */
export function RepositoryCommit({
	state,
	onAction,
	onCommit,
	onCancel,
	onAiSettings,
	onUndo,
	readLast,
}: {
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	onCommit?: () => void;
	onCancel?: () => void;
	onAiSettings?: () => void;
	onUndo?: (input: CommitRecoveryInput) => Promise<string | null>;
	readLast?: typeof CommitReader.readLast;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles, scrollPaddingBottom } = themedStyles.get(theme);
	const prefix = CommitSubject.prefix(state.commitMessage);

	const textColorRanges:
		| { start: number; end: number; color: string }[]
		| undefined = prefix
		? [
				{
					start: 0,
					end: prefix.length,
					color: commitTypeColor(theme.appearance, prefix.type).color,
				},
			]
		: undefined;

	if (prefix?.scope) {
		textColorRanges?.push(
			{
				start: prefix.scope.start,
				end: prefix.scope.start + 1,
				color: theme.colors.editorMuted,
			},
			{
				start: prefix.scope.end - 1,
				end: prefix.scope.end,
				color: theme.colors.editorMuted,
			}
		);
	}

	const separator = bodySeparator.exec(state.commitMessage);
	const bodyOffset = separator ? separator.index + separator[0].length : null;

	const emptyBody =
		separator !== null &&
		bodyOffset !== null &&
		state.commitMessage.slice(0, separator.index).trim().length > 0 &&
		state.commitMessage.slice(bodyOffset).trim().length === 0;

	const [previewed, setPreviewed] = useState(false);

	const notice = useRef<PublicInstance>(null);
	const messageInput = useRef<PublicInstance>(null);
	const renderer = useGpuixRequired();
	const { overrides } = useKeybinds();
	const commitShortcut = Keybinds.label("commit", overrides);

	const generation = useAiCommit({
		state,
		onMessage: (value) => {
			onAction({ type: "edit-commit-message", value });

			if (messageInput.current)
				renderer.focusElement?.(messageInput.current.id);
		},
	});

	const amendHead = state.amend?.head;

	useEffect(() => {
		if (amendHead && messageInput.current)
			renderer.focusElement?.(messageInput.current.id);
	}, [amendHead, renderer]);

	const hasDetails = !!state.commit.error || state.commit.needsReview;

	const canPreview = RepositoryWorkspaceModel.canPreviewCommit(state);
	const sample = state.preview;

	const canSubmit =
		!generation.busy &&
		(sample ? canPreview : RepositoryWorkspaceModel.canCommit(state));

	const blocked = sample
		? null
		: RepositoryWorkspaceModel.commitBlockReason(state);

	const noticeText = !sample
		? (state.commit.error ??
			(state.commit.needsReview ? state.commit.notice : null) ??
			blocked)
		: previewed
			? "Preview only — no commit created."
			: state.repository
				? "Preview only · Git writes disabled"
				: "Preview only · no repository connected";

	const count = state.includedFileIds.length;

	const label = state.amend
		? "Amend commit"
		: `Commit ${count} ${count === 1 ? "file" : "files"}`;

	const submit = (): void => {
		if (!canSubmit) return;

		if (sample) setPreviewed(true);
		else onCommit?.();
	};

	return (
		<div testId="commit-composer" style={styles.composer}>
			{!sample &&
			(state.commit.pending ||
				state.commit.error ||
				state.commit.needsReview) ? (
				<RepositoryCommitProcess
					commit={state.commit}
					onCancel={state.commit.cancellable ? onCancel : undefined}
				/>
			) : null}
			{state.amend ? (
				<div
					testId="amend-header"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: spacing[1],
						paddingLeft: spacing[2.5],
						paddingRight: spacing[2.5],
						paddingTop: spacing[1.5],
						marginBottom: spacing[1.5],
					}}
				>
					<text
						testId="amend-label"
						style={{ ...styles.hint, whiteSpace: "nowrap", flexGrow: 1 }}
					>
						{`Amending ${state.amend.head.slice(0, 7)}`}
					</text>
					<Button
						testId="amend-cancel"
						variant="secondary"
						size="sm"
						tokens={appTokens}
						disabled={RepositoryWorkspaceModel.isBusy(state)}
						onPress={() => {
							onAction({ type: "cancel-amend" });

							if (messageInput.current)
								renderer.focusElement?.(messageInput.current.id);
						}}
					>
						Cancel
					</Button>
				</div>
			) : null}
			<div testId="commit-editor-surface" style={styles.editorSurface}>
				<Textarea
					ref={messageInput}
					testId="commit-message"
					aria-label="Commit message"
					aria-description={
						sample
							? `First line is the summary. Add a blank line for optional details. ${commitShortcut} previews; no commit is created.`
							: `First line is the summary. Add a blank line for an optional description. ${commitShortcut}: ${label}.`
					}
					placeholder="Commit message…"
					textColorRanges={textColorRanges}
					linePlaceholder={
						emptyBody && bodyOffset !== null
							? {
									offset: bodyOffset,
									text: "Description (optional)",
									color: theme.colors.editorFaint,
								}
							: undefined
					}
					value={state.commitMessage}
					readOnly={generation.busy || RepositoryWorkspaceModel.isBusy(state)}
					onValueChange={(value) => {
						setPreviewed(false);
						onAction({ type: "edit-commit-message", value });
					}}
					scrollPaddingBottom={scrollPaddingBottom}
					tokens={appTokens}
					style={styles.editor}
					onKeyDown={(event) => {
						if (Keybinds.matches(event, "commit", renderer)) submit();
					}}
				/>
				<div testId="commit-actions-fade" style={styles.fade} />
				<div testId="commit-actions" style={styles.actions}>
					<AiCommitButton generation={generation} onSettings={onAiSettings} />
					<Button
						testId={sample ? "commit-preview" : "commit-submit"}
						aria-label={
							generation.progress ?? (sample ? `Preview: ${label}` : label)
						}
						aria-description={
							sample
								? "Preview only. Checkbox choices do not change files and no Git commit will be created."
								: state.amend
									? "Replace the last unpublished commit using this message and any checked changes. Unchecked changes stay in your working copy."
									: "Commit included changes in the checked files. Excluded changes stay in your working copy."
						}
						size="sm"
						tokens={appTokens}
						textStyle={styles.label}
						disabled={!canSubmit}
						onPress={submit}
					>
						{generation.progress ? (
							<AiCommitProgress progress={generation.progress} />
						) : state.commit.pending ? (
							state.amend ? (
								"Amending…"
							) : (
								"Committing…"
							)
						) : (
							label
						)}
					</Button>
				</div>
			</div>
			<AiCommitStatus generation={generation} />
			{noticeText && !state.commit.error && !state.commit.needsReview ? (
				<div
					key={state.commit.error ?? state.commit.notice ?? "hint"}
					ref={notice}
					testId="commit-notice-scroll"
					tabIndex={hasDetails ? 0 : -1}
					aria-label={hasDetails ? "Git operation details" : undefined}
					aria-description={
						hasDetails
							? "Use arrow keys or Page Up and Page Down to read all details."
							: undefined
					}
					style={styles.notice}
					onKeyDown={(event) => {
						const element = notice.current;

						if (
							!element ||
							event.modifiers?.cmd ||
							event.modifiers?.ctrl ||
							event.modifiers?.alt ||
							event.modifiers?.shift
						)
							return;

						const [, y = 0] = renderer.getScrollOffset?.(element.id) ?? [0, 0];
						const page = renderer.getElementBounds?.(element.id)?.height ?? 64;
						let next = y;

						if (event.key === "down") next -= 14;
						else if (event.key === "up") next += 14;
						else if (event.key === "pagedown" || event.key === "space")
							next -= page;
						else if (event.key === "pageup") next += page;
						else if (event.key === "home") next = 0;
						else if (event.key === "end") next = -Number.MAX_SAFE_INTEGER;

						if (next !== y)
							renderer.scrollTo?.(element.id, 0, Math.min(0, next));
					}}
				>
					{noticeText ? (
						<text
							testId="commit-notice"
							role={state.commit.error ? "alert" : "status"}
							style={styles.hint}
						>
							{noticeText}
						</text>
					) : null}
				</div>
			) : null}
			{!sample ? (
				<RepositoryLastCommit
					state={state}
					onUndo={onUndo}
					readLast={readLast}
					onAmend={(commit) => {
						if (!state.repository?.branchName) return;

						onAction({
							type: "amend-commit",
							head: commit.oid,
							branch: state.repository.branchName,
							message: commit.body || commit.summary,
						});
					}}
				/>
			) : null}
		</div>
	);
}

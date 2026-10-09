import {
	spacing,
	typography,
	fontWeight,
	lightColors,
} from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useRef, useState } from "react";

import { appTokens } from "../../../styles/tokens";
import { RepositoryLastCommit } from "./repository-last-commit";
import type { CommitRecoveryInput } from "@1git/git";
import type { RepositoryCommit as CommitReader } from "../lib/repository-commit";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

const styles = StyleSheet.create({
	composer: {
		display: "flex",
		flexDirection: "column",
		flexShrink: 0,
		gap: spacing[1.5],
		borderTopWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	editor: {
		height: 100,
		padding: spacing[2],
		paddingBottom: spacing[1],
		...typography.sm,
		backgroundColor: "transparent",
		borderWidth: 0,
		borderColor: "transparent",
	},
	actions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
		height: 24,
		marginBottom: spacing[2.5],
	},
	buttons: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[1.5],
	},
	hint: { ...typography["2xs"], color: lightColors.editorFaint },
	notice: {
		display: "flex",
		flexDirection: "column",
		gap: spacing[1],
		maxHeight: 64,
		marginLeft: spacing[2.5],
		marginRight: spacing[2.5],
		flexShrink: 0,
		overflowY: "scroll",
		overflowX: "hidden",
		borderWidth: 1,
		borderColor: "transparent",
	},
	label: { ...typography.sm, fontWeight: fontWeight.medium },
});

/** Whole-file commit composer; only explicit sample mode remains preview-only. */
export function RepositoryCommit({
	state,
	onAction,
	onCommit,
	onUndo,
	readLast,
}: {
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	onCommit?: () => void;
	onUndo?: (input: CommitRecoveryInput) => Promise<string | null>;
	readLast?: typeof CommitReader.readLast;
}) {
	const [previewed, setPreviewed] = useState(false);

	const notice = useRef<PublicInstance>(null);
	const renderer = useGpuixRequired();

	const hasDetails = !!state.commit.error || state.commit.needsReview;

	const canPreview = RepositoryWorkspaceModel.canPreviewCommit(state);
	const sample = state.preview;

	const canSubmit = sample
		? canPreview
		: RepositoryWorkspaceModel.canCommit(state);

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

	const label = `Commit ${count} ${count === 1 ? "file" : "files"}`;

	const submit = (): void => {
		if (!canSubmit) return;

		if (sample) setPreviewed(true);
		else onCommit?.();
	};

	return (
		<div testId="commit-composer" style={styles.composer}>
			<Textarea
				testId="commit-message"
				aria-label="Commit message"
				aria-description={
					sample
						? "First line is the summary. Add a blank line for optional details. Command Enter previews; no commit is created."
						: `First line is the summary. Command Enter: ${label}.`
				}
				placeholder="Commit message…"
				value={state.commitMessage}
				readOnly={RepositoryWorkspaceModel.isBusy(state)}
				onValueChange={(value) => {
					setPreviewed(false);
					onAction({ type: "edit-commit-message", value });
				}}
				minRows={5}
				maxRows={5}
				tokens={appTokens}
				style={styles.editor}
				onKeyDown={(event) => {
					if (
						event.key === "enter" &&
						event.modifiers?.cmd &&
						!event.modifiers.ctrl &&
						!event.modifiers.alt &&
						!event.modifiers.shift &&
						!event.isHeld
					)
						submit();
				}}
			/>
			<div style={styles.actions}>
				<div style={styles.buttons}>
					<Button
						testId={sample ? "commit-preview" : "commit-submit"}
						aria-label={sample ? `Preview: ${label}` : label}
						aria-description={
							sample
								? "Preview only. Checkbox choices do not change files and no Git commit will be created."
								: "Commit included changes in the checked files. Excluded changes stay in your working copy."
						}
						size="sm"
						tokens={appTokens}
						textStyle={styles.label}
						disabled={!canSubmit}
						onPress={submit}
					>
						{state.commit.pending ? "Committing…" : label}
					</Button>
				</div>
			</div>
			{noticeText ? (
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
				/>
			) : null}
		</div>
	);
}

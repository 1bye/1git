import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useRef, useState } from "react";

import { appTokens } from "../../../styles/tokens";
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
		padding: 10,
		gap: 6,
		borderTopWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	editor: {
		height: 100,
		padding: 4,
		fontSize: 11,
		lineHeight: 16,
		backgroundColor: "transparent",
		borderColor: "transparent",
	},
	actions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		flexShrink: 0,
		height: 24,
	},
	hint: { fontSize: 9, color: lightColors.editorFaint },
	notice: {
		maxHeight: 64,
		flexShrink: 0,
		overflowY: "scroll",
		overflowX: "hidden",
		borderWidth: 1,
		borderColor: "transparent",
	},
	label: { fontSize: 11, fontWeight: 500 },
});

/** Whole-file commit composer; only explicit sample mode remains preview-only. */
export function RepositoryCommit({
	state,
	onAction,
	onCommit,
}: {
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	onCommit?: (mode: "files" | "staged") => void;
}) {
	const [previewed, setPreviewed] = useState(false);
	const [mode, setMode] = useState<"files" | "staged">("files");
	const [noticeFocused, setNoticeFocused] = useState(false);
	const notice = useRef<PublicInstance>(null);
	const renderer = useGpuixRequired();
	const hasDetails = !!state.commit.error || state.commit.needsReview;
	const canPreview = RepositoryWorkspaceModel.canPreviewCommit(state);
	const sample = state.preview;

	const canSubmit = sample
		? canPreview
		: RepositoryWorkspaceModel.canCommit(state, mode);

	const blocked = sample
		? null
		: RepositoryWorkspaceModel.commitBlockReason(state, mode);

	const noticeText = !sample
		? state.commit.pending
			? "Committing. Please keep the app open."
			: (state.commit.error ?? state.commit.notice ?? blocked)
		: previewed
			? "Preview only — no commit created."
			: state.repository
				? "Preview only · Git writes disabled"
				: "Preview only · no repository connected";

	const count = state.includedFileIds.length;

	const label =
		mode === "staged"
			? "Commit staged changes"
			: `Commit ${count} ${count === 1 ? "file" : "files"}`;

	const submit = (): void => {
		if (!canSubmit) return;

		if (sample) setPreviewed(true);
		else onCommit?.(mode);
	};

	return (
		<div testId="commit-composer" style={styles.composer}>
			{!sample ? (
				<div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
					{(["files", "staged"] as const).map((value) => (
						<Button
							key={value}
							testId={`commit-mode-${value}`}
							tokens={appTokens}
							size="sm"
							variant={mode === value ? "secondary" : "ghost"}
							disabled={RepositoryWorkspaceModel.isBusy(state)}
							onPress={() => setMode(value)}
						>
							{value === "files" ? "Checked files" : "Staged changes"}
						</Button>
					))}
				</div>
			) : null}
			{mode === "staged" ? (
				<text style={styles.hint}>
					Commits all staged changes. File checkboxes are ignored.
				</text>
			) : null}
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
				<text style={styles.hint}>⌘ Enter</text>
				<Button
					testId={sample ? "commit-preview" : "commit-submit"}
					aria-label={sample ? `Preview: ${label}` : label}
					aria-description={
						sample
							? "Preview only. Checkbox choices do not stage files and no Git commit will be created."
							: mode === "staged"
								? "Commit only the index; unstaged changes stay untouched."
								: "Commit the checked whole files. Excluded files and their staging are preserved."
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
			{noticeText ? (
				<div
					key={state.commit.error ?? state.commit.notice ?? "hint"}
					ref={notice}
					testId="commit-notice-scroll"
					tabIndex={hasDetails ? 0 : -1}
					aria-label={hasDetails ? "Commit details" : undefined}
					aria-description={
						hasDetails
							? "Use arrow keys or Page Up and Page Down to read all details."
							: undefined
					}
					onFocus={() => setNoticeFocused(true)}
					onBlur={() => setNoticeFocused(false)}
					style={StyleSheet.compose(
						styles.notice,
						hasDetails &&
							noticeFocused && { borderColor: appTokens.colors.focusRing }
					)}
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
					<text
						testId="commit-notice"
						role={state.commit.error ? "alert" : "status"}
						style={styles.hint}
					>
						{noticeText}
					</text>
				</div>
			) : null}
		</div>
	);
}

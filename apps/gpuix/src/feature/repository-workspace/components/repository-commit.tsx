import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { useState } from "react";

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
	label: { fontSize: 11, fontWeight: 500 },
});

/** In-memory commit composer: previewing never writes Git data or clears the draft. */
export function RepositoryCommit({
	state,
	onAction,
}: {
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
}) {
	const [previewed, setPreviewed] = useState(false);
	const canPreview = RepositoryWorkspaceModel.canPreviewCommit(state);
	const count = state.includedFileIds.length;
	const label = `Commit ${count} ${count === 1 ? "file" : "files"}`;

	const preview = (): void => {
		if (canPreview) setPreviewed(true);
	};

	return (
		<div testId="commit-composer" style={styles.composer}>
			<Textarea
				testId="commit-message"
				aria-label="Commit message"
				aria-description="First line is the summary. Add a blank line for optional details. Command Enter previews; no commit is created."
				placeholder="Commit message…"
				value={state.commitMessage}
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
						preview();
				}}
			/>
			<div style={styles.actions}>
				<text style={styles.hint}>⌘ Enter</text>
				<Button
					testId="commit-preview"
					aria-label={`Preview: ${label}`}
					aria-description="Preview only. Checkbox choices do not stage files and no Git commit will be created."
					size="sm"
					tokens={appTokens}
					textStyle={styles.label}
					disabled={!canPreview}
					onPress={preview}
				>
					{label}
				</Button>
			</div>
			<text testId="commit-notice" role="status" style={styles.hint}>
				{previewed
					? "Preview only — no commit created."
					: state.repository
						? "Preview only · Git writes disabled"
						: "Preview only · no repository connected"}
			</text>
		</div>
	);
}

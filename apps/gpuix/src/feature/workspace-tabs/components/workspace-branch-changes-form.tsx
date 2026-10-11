import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { useState } from "react";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const styles = StyleSheet.create({
		form: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minHeight: 0,
			padding: spacing[2],
			gap: spacing[2.5],
		},
		content: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minHeight: 0,
			gap: spacing[2.5],
			overflowY: "scroll",
		},
		heading: { ...typography.md, fontWeight: fontWeight.medium },
		muted: { ...typography.sm, color: appTokens.colors.textMuted },
		choice: {
			width: "100%",
			height: 66,
			padding: spacing[2],
			gap: spacing[1],
			flexDirection: "column",
			alignItems: "flex-start",
			flexShrink: 0,
		},
		footer: {
			display: "flex",
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			gap: spacing[1.5],
		},
	});

	return { styles };
});

/** Explicit branch-switch or saved-work restoration intent; actions remain outside scrolling content. */
export function WorkspaceBranchChangesForm({
	name,
	source,
	restore,
	busy,
	onCancel,
	onConfirm,
}: {
	name: string;
	source: string;
	restore: boolean;
	busy: boolean;
	onCancel: () => void;
	onConfirm: (changes: "leave" | "bring") => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles[theme.appearance];

	const [choice, setChoice] = useState<"leave" | "bring">("leave");

	return (
		<div testId="branch-changes-form" style={styles.form}>
			<div testId="branch-changes-content" style={styles.content}>
				<Text tokens={appTokens} style={styles.heading}>
					{restore ? "Restore saved changes?" : "What about your changes?"}
				</Text>
				<Text tokens={appTokens} style={styles.muted}>
					{restore
						? `Saved work is available for “${name}”. Restore it now or keep it in Stashes for later.`
						: `Switch to “${name}” without losing your uncommitted work.`}
				</Text>
				{!restore ? (
					<>
						<Button
							testId="leave-branch-changes"
							tokens={appTokens}
							variant="secondary"
							size="sm"
							style={{
								...styles.choice,
								borderWidth: 1,
								borderColor:
									choice === "leave"
										? appTokens.colors.accentBorder
										: appTokens.colors.border,
							}}
							aria-label={`Leave changes on this branch${choice === "leave" ? ", selected" : ""}`}
							autoFocus
							disabled={busy}
							onPress={() => setChoice("leave")}
						>
							<Text tokens={appTokens} style={styles.heading}>
								Leave changes on this branch
							</Text>
							<Text
								tokens={appTokens}
								style={styles.muted}
							>{`Save on “${source}”; restore when you return.`}</Text>
						</Button>
						<Button
							testId="bring-branch-changes"
							tokens={appTokens}
							variant="secondary"
							size="sm"
							style={{
								...styles.choice,
								borderWidth: 1,
								borderColor:
									choice === "bring"
										? appTokens.colors.accentBorder
										: appTokens.colors.border,
							}}
							aria-label={`Bring changes with me${choice === "bring" ? ", selected" : ""}`}
							disabled={busy}
							onPress={() => setChoice("bring")}
						>
							<Text tokens={appTokens} style={styles.heading}>
								Bring changes with me
							</Text>
							<Text tokens={appTokens} style={styles.muted}>
								Move the work; keep a backup if conflicts occur.
							</Text>
						</Button>
					</>
				) : null}
			</div>
			<div style={styles.footer}>
				<Button
					testId="cancel-branch-changes"
					tokens={appTokens}
					variant="ghost"
					size="sm"
					disabled={busy}
					onPress={onCancel}
				>
					{restore ? "Not now" : "Cancel"}
				</Button>
				<Button
					testId="confirm-branch-changes"
					autoFocus={restore}
					tokens={appTokens}
					size="sm"
					disabled={busy}
					onPress={() => onConfirm(choice)}
				>
					{busy ? "Working…" : restore ? "Restore changes" : "Switch branch"}
				</Button>
			</div>
		</div>
	);
}

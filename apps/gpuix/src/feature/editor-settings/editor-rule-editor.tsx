import { useAppTheme } from "../../styles/theme";
import { radius, spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { SettingsPanel, settingsStyles } from "../settings/settings-layout";
import { SettingsGroup } from "../settings/settings-group";
import { EditorChoices } from "./editor-choices";
import {
	ExternalEditors,
	type EditorApplication,
	type EditorRule,
} from "./external-editors";

/** Right-side draft form; choosing an application does not change defaults until Save. */
export function EditorRuleEditor({
	rule,
	applications,
	editors,
	onSave,
	onCancel,
	onBusy,
}: {
	rule: EditorRule | null;
	applications: readonly EditorApplication[];
	editors: ExternalEditors;
	onSave: (
		id: string | null,
		patterns: string,
		application: string | null
	) => Promise<void>;
	onCancel: () => void;
	onBusy: (busy: boolean) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const styles = settingsStyles.get(theme);

	const renderer = useGpuixRequired();
	const [patterns, setPatterns] = useState(rule?.patterns.join(", ") ?? "");
	const [application, setApplication] = useState(rule?.application ?? null);
	const [choices, setChoices] = useState(applications);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const pending = useRef(false);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);

	const submit = async (pick: boolean) => {
		if (pending.current) return;

		pending.current = true;
		setBusy(true);
		onBusy(true);
		setError(undefined);

		try {
			if (pick) {
				if (!renderer.promptForPaths)
					throw new Error("Application selection is unavailable.");

				const paths = await renderer.promptForPaths({
					files: true,
					directories: false,
					multiple: false,
					prompt: "Choose editor application",
				});

				if (!mounted.current || !paths?.[0]) return;

				const selected = await editors.application(paths[0]);

				if (!mounted.current) return;

				setApplication(selected.path);
				setChoices((previous) => [
					...previous.filter((app) => app.path !== selected.path),
					selected,
				]);
			} else await onSave(rule?.id ?? null, patterns, application);
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not save the editor rule."
				);
		} finally {
			pending.current = false;
			onBusy(false);

			if (mounted.current) setBusy(false);
		}
	};

	return (
		<SettingsPanel
			testId="editor-rule-editor"
			scrollTestId="editor-rule-scroll"
			footerTestId="editor-rule-footer"
			title={rule ? "Edit file type default" : "Add file type default"}
			label={rule ? "Edit file type default" : "Add file type default"}
			body={
				<>
					<text style={styles.label}>File types or names</text>
					<input
						testId="editor-rule-patterns"
						aria-label="File types or names"
						value={patterns}
						autoFocus
						tabIndex={busy ? undefined : 0}
						readOnly={busy}
						style={{
							height: appTokens.layout.controlHeight,
							...styles.label,
							borderWidth: 1,
							borderColor: appTokens.colors.border,
							borderRadius: radius.md,
							paddingLeft: spacing[2.5],
							paddingRight: spacing[2.5],
							flexShrink: 0,
						}}
						onChange={(event) => {
							if (!busy) setPatterns(event.value ?? "");
						}}
					/>
					<text style={{ ...styles.description }}>.ts, .tsx, Dockerfile</text>
					<SettingsGroup
						title="Application"
						action={
							<Button
								testId="editor-rule-choose-application"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								disabled={busy}
								onPress={() => {
									void submit(true);
								}}
							>
								Choose application…
							</Button>
						}
					>
						<EditorChoices
							prefix="editor-rule-choice"
							applications={choices}
							selected={application}
							disabled={busy}
							onChoose={setApplication}
						/>
					</SettingsGroup>

					{error ? (
						<text
							testId="editor-rule-error"
							role="alert"
							style={{ ...styles.error }}
						>
							{error}
						</text>
					) : null}
				</>
			}
			footer={
				<div style={{ ...styles.header, justifyContent: "flex-end" }}>
					<Button
						testId="editor-rule-cancel"
						tokens={appTokens}
						variant="secondary"
						size="sm"
						disabled={busy}
						onPress={onCancel}
					>
						Cancel
					</Button>
					<Button
						testId="editor-rule-save"
						tokens={appTokens}
						size="sm"
						disabled={busy || !patterns.trim()}
						onPress={() => {
							void submit(false);
						}}
					>
						Save
					</Button>
				</div>
			}
		/>
	);
}

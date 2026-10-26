import { useAppTheme } from "../../styles/theme";
import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired } from "@gpuix/react";
import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";

import { accountActionIcons } from "../accounts/account-list";
import {
	SettingsPage,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import {
	SettingsGroup,
	SettingsGroupRow,
	SettingsGroupEmpty,
} from "../settings/settings-group";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { EditorChoices } from "./editor-choices";
import { EditorRuleEditor } from "./editor-rule-editor";
import { ExternalEditors, type EditorRule } from "./external-editors";

/** Settings dismisses a rule draft before leaving the page. */
export interface EditorSettingsHandle {
	cancelEditor: () => boolean;
}

/** Immediate overall default and explicitly saved file-type overrides, sharing one application catalog. */
export function EditorSettings({
	ref,
	editors: supplied,
	onBusy,
}: {
	ref?: Ref<EditorSettingsHandle>;
	editors?: ExternalEditors;
	onBusy: (busy: boolean) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const styles = settingsStyles.get(theme);

	const renderer = useGpuixRequired();
	const [editors] = useState(() => supplied ?? new ExternalEditors());

	const [options, setOptions] =
		useState<Awaited<ReturnType<ExternalEditors["options"]>>>();

	const [editing, setEditing] = useState<EditorRule | "add" | null>(null);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const mounted = useRef(false);
	const returnFocus = useRef<number | null>(null);
	const locked = busy || !options || editing !== null;

	useImperativeHandle(
		ref,
		() => ({
			cancelEditor() {
				if (!editing) return false;

				if (!pending.current) setEditing(null);

				return true;
			},
		}),
		[editing]
	);
	useEffect(() => {
		if (editing || returnFocus.current === null) return;

		const focus = returnFocus.current;
		const timer = setTimeout(() => renderer.focusElement?.(focus), 0);

		returnFocus.current = null;

		return () => clearTimeout(timer);
	}, [editing, renderer]);
	useEffect(() => {
		mounted.current = true;
		void (async () => {
			try {
				const next = await editors.options(true);

				if (mounted.current) setOptions(next);
			} catch (cause) {
				if (mounted.current)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not load editor settings."
					);
			}
		})();

		return () => {
			mounted.current = false;
		};
	}, [editors]);
	const setLocked = (next: boolean) => {
		pending.current = next;

		if (mounted.current) setBusy(next);

		onBusy(next);
	};

	const choose = async (path: string | null | undefined, remove?: string) => {
		if (pending.current || !options) return;

		setLocked(true);
		setError(undefined);

		try {
			if (remove) editors.removeRule(remove);
			else {
				if (path === undefined) {
					if (!renderer.promptForPaths)
						throw new Error("Application selection is unavailable.");

					const paths = await renderer.promptForPaths({
						files: true,
						directories: false,
						multiple: false,
						prompt: "Choose editor application",
					});

					if (!mounted.current || !paths?.[0]) return;

					path = paths[0];
				}

				await editors.save(path);
			}

			const next = await editors.options();

			if (mounted.current) setOptions(next);
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not save the editor preference."
				);
		} finally {
			setLocked(false);
		}
	};

	const edit = (rule: EditorRule | "add") => {
		returnFocus.current = renderer.getFocusedElementId?.() ?? null;
		setEditing(rule);
		setError(undefined);
	};

	return (
		<SettingsSplit
			testId="editor-settings"
			list={
				<SettingsPage
					testId="editor-settings-page"
					scrollTestId="editor-settings-scroll"
					title="External editor"
				>
					<SettingsGroup title="Default editor">
						<EditorChoices
							applications={options?.applications ?? []}
							selected={options?.selected ?? null}
							disabled={locked}
							onChoose={(path) => {
								void choose(path);
							}}
						/>
						<SettingsGroupRow
							testId="editor-choose-application"
							label="Other application…"
							leading={<WorkspaceTabIcon name="add" />}
							disabled={locked}
							onPress={() => {
								void choose(undefined);
							}}
						/>
					</SettingsGroup>
					<SettingsGroup
						title="File type rules"
						action={
							<Button
								testId="editor-rule-add"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								disabled={locked}
								onPress={() => edit("add")}
							>
								Add rule
							</Button>
						}
					>
						{!options?.rules.length ? (
							<SettingsGroupEmpty>
								All files use the default editor.
							</SettingsGroupEmpty>
						) : null}
						{options?.rules.map((rule) => (
							<SettingsGroupRow
								key={rule.id}
								testId={`editor-rule-${rule.id}`}
								label={`${rule.patterns.join(", ")} → ${rule.application ? (options.applications.find((app) => app.path === rule.application)?.name ?? "Unavailable application") : "System default"}`}
								disabled={locked}
								onPress={() => edit(rule)}
								trailing={
									<div
										style={{
											display: "flex",
											flexDirection: "row",
											gap: spacing[2],
										}}
									>
										<Button
											testId={`editor-rule-edit-${rule.id}`}
											aria-label={`Edit ${rule.patterns.join(", ")}`}
											tokens={appTokens}
											variant="ghost"
											size="sm"
											disabled={locked}
											onPress={() => edit(rule)}
										>
											<svg
												source={accountActionIcons.reconnect}
												style={{
													width: 16,
													height: 16,
													color: appTokens.colors.textMuted,
													pointerEvents: "none",
												}}
											/>
										</Button>
										<Button
											testId={`editor-rule-remove-${rule.id}`}
											aria-label={`Remove ${rule.patterns.join(", ")}`}
											tokens={appTokens}
											variant="ghost"
											size="sm"
											disabled={locked}
											onPress={() => {
												void choose(null, rule.id);
											}}
										>
											<svg
												source={accountActionIcons.remove}
												style={{
													width: 16,
													height: 16,
													color: appTokens.colors.danger,
													pointerEvents: "none",
												}}
											/>
										</Button>
									</div>
								}
							/>
						))}
					</SettingsGroup>
					{error ? (
						<text
							testId="editor-settings-error"
							role="alert"
							style={{ ...styles.error }}
						>
							{error}
						</text>
					) : null}
				</SettingsPage>
			}
			panel={
				editing && options ? (
					<EditorRuleEditor
						key={editing === "add" ? "add" : editing.id}
						rule={editing === "add" ? null : editing}
						applications={options.applications}
						editors={editors}
						onBusy={setLocked}
						onCancel={() => setEditing(null)}
						onSave={async (id, patterns, application) => {
							await editors.saveRule(id, patterns, application);
							const next = await editors.options();

							if (mounted.current) {
								setOptions(next);
								setEditing(null);
							}
						}}
					/>
				) : null
			}
		/>
	);
}

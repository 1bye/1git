import { useAppTheme } from "../../styles/theme";
import { fontWeight, spacing, typography } from "@1git/design-tokens";
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

	const heading = {
		...typography.lg,
		fontWeight: fontWeight.medium,
		color: appTokens.colors.text,
	};

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: spacing[2],
		flexShrink: 0,
	};

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
		<div
			testId="editor-settings"
			style={{
				display: "flex",
				flexDirection: "row",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
			}}
		>
			<div
				testId="editor-settings-scroll"
				style={{
					display: "flex",
					flexDirection: "column",
					width: editing ? "50%" : "100%",
					flexGrow: editing ? 0 : 1,
					minWidth: 0,
					minHeight: 0,
					overflowY: "scroll",
					padding: spacing[4],
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						maxWidth: 480,
						width: "100%",
						gap: spacing[3],
						flexShrink: 0,
					}}
				>
					<div style={row}>
						<text role="heading" aria-level={1} style={heading}>
							External editor
						</text>
						<Button
							testId="editor-choose-application"
							tokens={appTokens}
							variant="secondary"
							size="sm"
							disabled={locked}
							onPress={() => {
								void choose(undefined);
							}}
						>
							Choose application…
						</Button>
					</div>
					<text style={{ ...typography.sm, color: appTokens.colors.textMuted }}>
						Default editor
					</text>
					<EditorChoices
						applications={options?.applications ?? []}
						selected={options?.selected ?? null}
						disabled={locked}
						onChoose={(path) => {
							void choose(path);
						}}
					/>
					<div style={{ ...row, marginTop: spacing[4] }}>
						<text role="heading" aria-level={2} style={heading}>
							File type defaults
						</text>
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
					</div>
					{!options?.rules.length ? (
						<text
							style={{ ...typography.sm, color: appTokens.colors.textMuted }}
						>
							All files use the default editor.
						</text>
					) : null}
					{options?.rules.map((rule) => (
						<div key={rule.id} testId={`editor-rule-${rule.id}`} style={row}>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[1],
									flexGrow: 1,
									minWidth: 0,
								}}
							>
								<text
									style={{
										...typography.md,
										color: appTokens.colors.text,
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{rule.patterns.join(", ")}
								</text>
								<text
									style={{
										...typography.sm,
										color: appTokens.colors.textMuted,
									}}
								>
									{rule.application
										? (options.applications.find(
												(app) => app.path === rule.application
											)?.name ?? "Unavailable application")
										: "System default"}
								</text>
							</div>
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
					))}
					{error ? (
						<text
							testId="editor-settings-error"
							role="alert"
							style={{ ...typography.sm, color: appTokens.colors.danger }}
						>
							{error}
						</text>
					) : null}
				</div>
			</div>
			{editing && options ? (
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
			) : null}
		</div>
	);
}

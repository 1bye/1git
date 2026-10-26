import { useLayoutEffect, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import {
	SettingsPage,
	SettingsSection,
	settingsStyles,
} from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import { radius, spacing } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { useKeybinds } from "./keybind-context";
import {
	Keybinds,
	keybindCommands,
	keybindRecordings,
	type KeybindCommand,
} from "./keybinds";

/** Searchable app shortcuts and window-local customization, persisted with the workspace session. */
export function KeybindSettings() {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const { overrides, setOverrides } = useKeybinds();
	const [query, setQuery] = useState("");
	const search = query.trim().toLowerCase();
	const includes = (text: string) => text.toLowerCase().includes(search);

	const commands = keybindCommands.filter((command) =>
		includes(
			`${command.label} ${command.group} ${command.description ?? ""} ${Keybinds.bindings(command, overrides).map(Keybinds.format).join(" ")} ${Keybinds.binding(command, overrides)}`
		)
	);

	return (
		<SettingsPage
			testId="keybinds-settings"
			title="Keybinds"
			width="wide"
			description="Click a shortcut to change it. Changes apply immediately and are saved for this window."
			action={
				<Button
					tokens={tokens}
					size="sm"
					variant="secondary"
					testId="keybinds-reset-all"
					disabled={!setOverrides || !Object.keys(overrides).length}
					onPress={() => setOverrides?.({})}
				>
					Restore defaults
				</Button>
			}
		>
			<SettingsSection>
				<input
					testId="keybinds-search"
					aria-label="Search keybinds"
					placeholder="Find an action or shortcut…"
					value={query}
					tabIndex={0}
					onChange={(event) => setQuery(event.value ?? "")}
					style={{
						...styles.label,
						height: 30,
						flexShrink: 0,
						paddingLeft: spacing[2],
						paddingRight: spacing[2],
						borderWidth: 1,
						borderColor: tokens.colors.border,
						borderRadius: radius.md,
						color: tokens.colors.text,
						backgroundColor: "transparent",
					}}
				/>
			</SettingsSection>
			{(["Application", "Spaces", "Tabs", "Repository"] as const).map(
				(group) => {
					const rows = commands.filter((command) => command.group === group);

					return rows.length ? (
						<SettingsGroup
							key={group}
							title={group}
							label={`${group} shortcuts`}
							meta={`${rows.length} ${rows.length === 1 ? "shortcut" : "shortcuts"}`}
						>
							{rows.map((command) => (
								<KeybindRow key={command.id} command={command} />
							))}
						</SettingsGroup>
					) : null;
				}
			)}
			{!commands.length ? (
				<text role="status" style={{ ...styles.description }}>
					No matching keybinds.
				</text>
			) : null}
		</SettingsPage>
	);
}

function KeybindRow({ command }: { command: KeybindCommand }) {
	const renderer = useGpuixRequired();
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const { overrides, setOverrides } = useKeybinds();
	const [open, setOpen] = useState(false);
	const [candidate, setCandidate] = useState<string>();
	const [resetError, setResetError] = useState<string | null>(null);

	const error = candidate
		? Keybinds.error(overrides, command.id, candidate)
		: null;

	const label = Keybinds.bindings(command, overrides)
		.map(Keybinds.format)
		.join(" / ");

	useLayoutEffect(() => {
		if (!open) return;

		const capture = (
			event: Parameters<typeof Keybinds.matches>[0]
		): boolean => {
			if (
				!event.modifiers?.cmd &&
				!event.modifiers?.ctrl &&
				!event.modifiers?.alt &&
				["escape", "tab", "enter"].includes(event.key ?? "")
			)
				return false;

			const binding = Keybinds.fromEvent(event);

			if (!event.isHeld && binding) setCandidate(binding);

			return true;
		};

		keybindRecordings.set(renderer, capture);

		return () => {
			if (keybindRecordings.get(renderer) === capture)
				keybindRecordings.delete(renderer);
		};
	}, [open, renderer]);

	const save = (binding: string) => {
		setOverrides?.((previous) => {
			const next = { ...previous };

			if (binding === command.key) delete next[command.id];
			else next[command.id] = binding;

			return next;
		});
		setOpen(false);
	};

	return (
		<>
			<SettingsGroupRow
				label={command.label}
				description={command.description}
				trailing={
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: spacing[3],
						}}
					>
						{command.fixed ? (
							<text style={{ ...styles.description }}>{label}</text>
						) : (
							<Popover
								open={open}
								onOpenChange={(next) => {
									setCandidate(undefined);
									setResetError(null);
									setOpen(next);
								}}
							>
								<PopoverTrigger asChild>
									<Button
										testId={`keybind-edit-${command.id}`}
										tokens={tokens}
										size="sm"
										variant="secondary"
										disabled={!setOverrides}
										aria-label={`Change shortcut for ${command.label}`}
										style={{ minWidth: 80 }}
									>
										{label}
									</Button>
								</PopoverTrigger>
								<PopoverContent
									tokens={tokens}
									placement="center"
									width={430}
									testId="keybind-recorder"
									aria-label={`Change ${command.label} shortcut`}
								>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[3],
										}}
									>
										<text
											role="heading"
											aria-level={2}
											style={{ ...styles.sectionTitle }}
										>
											{command.label}
										</text>
										<text style={{ ...styles.description }}>
											Press a shortcut, then Save. Include Command, Control, or
											Option. Escape cancels.
										</text>
										<div
											tabIndex={0}
											autoFocus
											testId="keybind-recording"
											role="group"
											aria-label="Shortcut recorder"
											style={{
												padding: spacing[4],
												borderWidth: 1,
												borderColor: tokens.colors.border,
												borderRadius: radius.md,
												alignItems: "center",
											}}
										>
											<text style={{ ...styles.sectionTitle }}>
												{candidate
													? Keybinds.format(candidate)
													: "Press a shortcut…"}
											</text>
										</div>
										{error ? (
											<text
												role="alert"
												testId="keybind-error"
												style={{ ...styles.error }}
											>
												{error}
											</text>
										) : null}
										<div
											style={{
												display: "flex",
												flexDirection: "row",
												justifyContent: "flex-end",
												gap: spacing[2],
											}}
										>
											<Button
												tokens={tokens}
												size="sm"
												variant="secondary"
												testId="keybind-cancel"
												onPress={() => setOpen(false)}
											>
												Cancel
											</Button>
											<Button
												tokens={tokens}
												size="sm"
												testId="keybind-save"
												disabled={!candidate || !!error}
												onPress={() => {
													if (candidate && !error) save(candidate);
												}}
											>
												Save
											</Button>
										</div>
									</div>
								</PopoverContent>
							</Popover>
						)}
						{overrides[command.id] ? (
							<Button
								tokens={tokens}
								size="sm"
								variant="ghost"
								testId={`keybind-reset-${command.id}`}
								aria-label={`Reset ${command.label} shortcut`}
								onPress={() => {
									const failure = Keybinds.error(
										overrides,
										command.id,
										command.key
									);

									setResetError(failure);

									if (!failure) save(command.key);
								}}
							>
								Reset
							</Button>
						) : null}
					</div>
				}
			/>
			{resetError ? (
				<text role="alert" style={{ ...styles.error }}>
					{resetError}
				</text>
			) : null}
		</>
	);
}

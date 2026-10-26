import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@1git/gpuix-ui/popover";
import { spacing, radius } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import {
	SettingsPage,
	SettingsPanel,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { Keybinds } from "../keybinds/keybinds";
import { useKeybinds } from "../keybinds/keybind-context";
import { repositoryColorPresets } from "../repository-appearance/repository-colors";
import { WorkspaceSpaces, type WorkspaceSpace } from "./workspace-spaces";
import { spaceIconPresets, spaceIcons } from "./space-icons";
import { SpaceSymbol } from "./space-symbol";

/** The Settings back chain dismisses a space draft before leaving the page. */
export interface SpacesSettingsHandle {
	cancelEditor: () => boolean;
}

/** Application settings entry; deleting a custom space preserves its work in Default. */
export function SpacesSettings({
	ref,
	editor,
	onCancel,
	onSave,
	tabCounts,
	spaces,
	activeId,
	onCreate,
	onEdit,
	onSelect,
	onDelete,
}: {
	ref?: Ref<SpacesSettingsHandle>;
	editor?: { space?: WorkspaceSpace };
	onCancel: () => void;
	onSave: (value: Pick<WorkspaceSpace, "name" | "icon" | "color">) => void;
	tabCounts?: Readonly<Record<string, number>>;
	spaces: readonly WorkspaceSpace[];
	activeId: string;
	onCreate: () => void;
	onEdit: (space: WorkspaceSpace) => void;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const { overrides } = useKeybinds();
	const renderer = useGpuixRequired();
	const createButton = useRef<PublicInstance | null>(null);

	useImperativeHandle(
		ref,
		() => ({
			cancelEditor() {
				if (!editor) return false;

				onCancel();

				return true;
			},
		}),
		[editor, onCancel]
	);
	const cancel = useRef(onCancel);

	cancel.current = onCancel;
	useEffect(() => () => cancel.current(), []);
	const defaultName =
		spaces.find((space) => space.id === "default")?.name ?? "Default";

	return (
		<SettingsSplit
			testId="spaces-settings"
			list={
				<SettingsPage
					testId="spaces-settings-page"
					title="Spaces"
					description="Keep separate repositories and tabs for each part of your day."
					action={
						<Button
							tokens={tokens}
							size="sm"
							variant="secondary"
							testId="space-create"
							ref={createButton}
							disabled={spaces.length >= 50 || !!editor}
							onPress={onCreate}
						>
							New space…
						</Button>
					}
				>
					<SettingsGroup
						title="Spaces"
						meta={`${spaces.length} ${spaces.length === 1 ? "space" : "spaces"}`}
						footer={`Switch spaces with ${Keybinds.label("previous-space", overrides)} / ${Keybinds.label("next-space", overrides)}`}
					>
						{spaces.map((space) => (
							<SettingsGroupRow
								key={space.id}
								testId={`space-row-${space.id}`}
								leading={<SpaceSymbol icon={space.icon} color={space.color} />}
								label={space.name}
								description={`${space.repositories.length} ${space.repositories.length === 1 ? "repository" : "repositories"}${tabCounts?.[space.id] !== undefined ? ` · ${tabCounts[space.id]} ${tabCounts[space.id] === 1 ? "tab" : "tabs"}` : ""}`}
								badge={space.id === activeId ? "Current" : undefined}
								disabled={!!editor}
								onPress={() => onEdit(space)}
								trailing={
									<div
										style={{
											display: "flex",
											flexDirection: "row",
											gap: spacing[2],
										}}
									>
										<Button
											testId={`space-edit-${space.id}`}
											tokens={tokens}
											size="sm"
											variant="ghost"
											disabled={!!editor}
											onPress={() => onEdit(space)}
										>
											Edit…
										</Button>
										{space.id !== activeId ? (
											<Button
												testId={`space-select-${space.id}`}
												tokens={tokens}
												size="sm"
												variant="secondary"
												disabled={space.id === activeId || !!editor}
												onPress={() => onSelect(space.id)}
											>
												Switch
											</Button>
										) : null}
									</div>
								}
							/>
						))}
					</SettingsGroup>
				</SettingsPage>
			}
			panel={
				editor ? (
					<SpaceManager
						key={editor.space?.id ?? "new"}
						space={editor.space}
						defaultName={defaultName}
						onReturnFocus={() => {
							if (createButton.current)
								renderer.focusElement?.(createButton.current.id);
						}}
						onSave={onSave}
						onClose={onCancel}
						onDelete={onDelete}
					/>
				) : null
			}
		/>
	);
}

function SpaceDelete({
	disabled = false,
	space,
	defaultName,
	onDelete,
}: {
	disabled?: boolean;
	space: WorkspaceSpace;
	defaultName: string;
	onDelete: (id: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					tokens={tokens}
					size="sm"
					variant="ghost"
					textStyle={{ color: tokens.colors.danger }}
					testId={`space-delete-${space.id}`}
					disabled={disabled}
					aria-label={`Delete ${space.name} space`}
				>
					Delete…
				</Button>
			</PopoverTrigger>
			<PopoverContent
				tokens={tokens}
				placement="center"
				width={440}
				testId="space-delete-dialog"
				aria-label={`Delete ${space.name} space`}
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<text
						role="heading"
						aria-level={2}
						style={{ ...styles.sectionTitle }}
					>
						{`Delete ${space.name}?`}
					</text>
					<text style={{ ...styles.description }}>
						{`Repositories, open tabs, and drafts will move to ${defaultName}.`}
					</text>
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
							autoFocus
							testId="space-delete-cancel"
							onPress={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							tokens={tokens}
							size="sm"
							testId="space-delete-confirm"
							variant="secondary"
							textStyle={{ color: tokens.colors.danger }}
							onPress={() => onDelete(space.id)}
						>
							Delete space
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Compact editor for a space's name and outline icon. Changes apply only on Save. */
export function SpaceManager({
	presentation = "panel",
	onReturnFocus,
	onDelete,
	defaultName = "Default",
	space,
	onSave,
	onClose,
}: {
	presentation?: "panel" | "dialog";
	onReturnFocus?: () => void;
	onDelete?: (id: string) => void;
	defaultName?: string;
	space?: WorkspaceSpace;
	onSave: (value: Pick<WorkspaceSpace, "name" | "icon" | "color">) => void;
	onClose: () => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const renderer = useGpuixRequired();
	const previousFocus = useRef(renderer.getFocusedElementId?.());
	const returnFocus = useRef(onReturnFocus);

	returnFocus.current = onReturnFocus;
	const [name, setName] = useState(space?.name ?? "");

	const [icon, setIcon] = useState<string>(() =>
		spaceIcons.some((id) => id === space?.icon)
			? (space?.icon ?? "work")
			: "work"
	);

	const [color, setColor] = useState(space?.color);
	const [error, setError] = useState<string>();
	const iconSize = 40;

	useEffect(
		() => () => {
			if (
				previousFocus.current != null &&
				renderer.getElementBounds?.(previousFocus.current)
			)
				renderer.focusElement?.(previousFocus.current);
			else returnFocus.current?.();
		},
		[renderer]
	);

	const save = () => {
		if (!WorkspaceSpaces.validName(name)) {
			setError("Enter a space name, up to 60 characters.");

			return;
		}

		onSave({ name: name.trim(), icon, ...(color ? { color } : {}) });
	};

	const footer = (
		<>
			<Button
				tokens={tokens}
				size="sm"
				variant="secondary"
				testId="space-editor-cancel"
				onPress={onClose}
			>
				Cancel
			</Button>
			<Button
				tokens={tokens}
				size="sm"
				testId="space-editor-save"
				onPress={save}
			>
				{space ? "Save" : "Create space"}
			</Button>
		</>
	);

	const body = (
		<>
			<text style={styles.label}>Name</text>
			<input
				testId="space-name"
				aria-label="Space name"
				autoFocus
				tabIndex={0}
				value={name}
				placeholder="Work, Personal…"
				style={{
					...styles.label,
					height: 30,
					paddingLeft: spacing[2],
					paddingRight: spacing[2],
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.md,
					color: tokens.colors.text,
					backgroundColor: "transparent",
				}}
				onChange={(event) => setName(event.value ?? "")}
				onKeyDown={(event) => {
					if (event.key === "enter") save();
				}}
			/>
			<text style={styles.label}>Icon</text>
			<TooltipProvider delayDuration={350}>
				<div
					testId="space-icons"
					role="group"
					aria-label="Space icon"
					style={{
						display: "flex",
						flexDirection: "row",
						flexWrap: "wrap",
						gap: spacing[2],
						width: "100%",
						alignSelf: "center",
					}}
				>
					{spaceIconPresets.map((preset) => (
						<Tooltip key={preset.id}>
							<TooltipTrigger asChild>
								<Button
									tokens={tokens}
									size="sm"
									variant={icon === preset.id ? "secondary" : "ghost"}
									aria-label={`${preset.label} icon`}
									testId={`space-icon-${preset.id}`}
									onPress={() => setIcon(preset.id)}
									style={{
										width: iconSize,
										height: iconSize,
										paddingLeft: 0,
										paddingRight: 0,
									}}
								>
									<SpaceSymbol icon={preset.id} />
								</Button>
							</TooltipTrigger>
							<TooltipContent tokens={tokens} side="top" align="center">
								{preset.label}
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>
			{error ? (
				<text role="alert" style={{ ...styles.error }}>
					{error}
				</text>
			) : null}
			<text style={styles.label}>Colour</text>
			<div
				testId="space-colors"
				role="group"
				aria-label="Space colour"
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					gap: spacing[2],
				}}
			>
				<Button
					testId="space-color-default"
					tokens={tokens}
					size="sm"
					variant={!color ? "secondary" : "ghost"}
					onPress={() => setColor(undefined)}
				>
					Default
				</Button>
				{repositoryColorPresets.map((preset) => (
					<Button
						key={preset.color}
						tokens={tokens}
						testId={`space-color-${preset.color.slice(1)}`}
						aria-label={preset.name}
						aria-description={
							color === preset.color ? "Selected colour" : undefined
						}
						size="sm"
						variant="ghost"
						onPress={() => setColor(preset.color)}
						style={{
							width: 28,
							paddingLeft: 0,
							paddingRight: 0,
							height: 28,
							padding: 3,
							borderColor:
								color === preset.color
									? tokens.colors.focusRing
									: "transparent",
						}}
					>
						<div
							style={{
								width: 18,
								height: 18,
								borderRadius: radius.full,
								backgroundColor: preset.color,
								pointerEvents: "none",
							}}
						/>
					</Button>
				))}
			</div>
			{space && space.id !== "default" && onDelete ? (
				<SpaceDelete
					space={space}
					defaultName={defaultName}
					onDelete={(id) => {
						onDelete(id);
						onClose();
					}}
				/>
			) : null}
		</>
	);

	return presentation === "dialog" ? (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<PopoverContent
				tokens={tokens}
				placement="center"
				width={440}
				testId="space-editor"
				aria-label={space ? "Edit space" : "New space"}
			>
				<div style={styles.column}>
					<text role="heading" aria-level={2} style={styles.sectionTitle}>
						{space ? "Edit space" : "New space"}
					</text>
					{body}
					<div style={{ ...styles.header, justifyContent: "flex-end" }}>
						{footer}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	) : (
		<SettingsPanel
			testId="space-editor"
			scrollTestId="space-editor-scroll"
			footerTestId="space-editor-footer"
			title={space ? "Edit space" : "New space"}
			label={space ? "Edit space" : "New space"}
			body={body}
			footer={
				<div style={{ ...styles.header, justifyContent: "flex-end" }}>
					{footer}
				</div>
			}
		/>
	);
}

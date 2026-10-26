import { useEffect, useRef, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
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
	SettingsSection,
	settingsStyles,
} from "../settings/settings-layout";
import { WorkspaceSpaces, type WorkspaceSpace } from "./workspace-spaces";
import { spaceIconPresets, spaceIcons } from "./space-icons";
import { SpaceSymbol } from "./space-symbol";

/** Application settings entry; deleting a custom space preserves its work in Default. */
export function SpacesSettings({
	spaces,
	activeId,
	onCreate,
	onEdit,
	onSelect,
	onDelete,
}: {
	spaces: readonly WorkspaceSpace[];
	activeId: string;
	onCreate: () => void;
	onEdit: (space: WorkspaceSpace) => void;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);

	const defaultName =
		spaces.find((space) => space.id === "default")?.name ?? "Default";

	return (
		<SettingsPage
			testId="spaces-settings"
			title="Spaces"
			description="Keep separate repositories and tabs for each part of your day."
		>
			<SettingsSection>
				{spaces.map((space) => (
					<div
						key={space.id}
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: spacing[3],
						}}
					>
						<SpaceSymbol icon={space.icon} />
						<text
							style={{
								...styles.label,
								flexGrow: 1,
								minWidth: 0,
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{space.name}
						</text>
						<Button
							tokens={tokens}
							size="sm"
							variant="ghost"
							testId={`space-edit-${space.id}`}
							onPress={() => onEdit(space)}
						>
							Edit…
						</Button>
						<Button
							tokens={tokens}
							size="sm"
							variant="secondary"
							testId={`space-select-${space.id}`}
							disabled={space.id === activeId}
							onPress={() => onSelect(space.id)}
						>
							{space.id === activeId ? "Current" : "Switch"}
						</Button>
						{space.id !== "default" ? (
							<SpaceDelete
								space={space}
								defaultName={defaultName}
								onDelete={onDelete}
							/>
						) : null}
					</div>
				))}
				<Button
					tokens={tokens}
					size="sm"
					variant="secondary"
					testId="space-create"
					disabled={spaces.length >= 50}
					style={{ alignSelf: "flex-start" }}
					onPress={onCreate}
				>
					New space…
				</Button>
			</SettingsSection>
		</SettingsPage>
	);
}

function SpaceDelete({
	space,
	defaultName,
	onDelete,
}: {
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
	space,
	onSave,
	onClose,
}: {
	space?: WorkspaceSpace;
	onSave: (value: Pick<WorkspaceSpace, "name" | "icon">) => void;
	onClose: () => void;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const renderer = useGpuixRequired();
	const previousFocus = useRef(renderer.getFocusedElementId?.());
	const [name, setName] = useState(space?.name ?? "");

	const [icon, setIcon] = useState<string>(() =>
		spaceIcons.some((id) => id === space?.icon)
			? (space?.icon ?? "work")
			: "work"
	);

	const [error, setError] = useState<string>();
	const iconColumns = 8;
	const iconSize = 40;

	useEffect(
		() => () => {
			if (previousFocus.current != null)
				renderer.focusElement?.(previousFocus.current);
		},
		[renderer]
	);

	const save = () => {
		if (!WorkspaceSpaces.validName(name)) {
			setError("Enter a space name, up to 60 characters.");

			return;
		}

		onSave({ name: name.trim(), icon });
	};

	return (
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
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[3],
						minHeight: 0,
					}}
				>
					<text
						role="heading"
						aria-level={2}
						style={{ ...styles.sectionTitle }}
					>
						{space ? "Edit space" : "New space"}
					</text>
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
								width: iconColumns * iconSize + (iconColumns - 1) * spacing[2],
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
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

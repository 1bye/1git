import { basename } from "node:path";
import { useContext, useEffect, useRef, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { spacing, typography, radius } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { MachineContext } from "../machines/machine-context";
import { MachineLocation } from "../machines/machine-location";
import {
	WorkspaceSpaces,
	spaceIcons,
	type WorkspaceSpace,
} from "./workspace-spaces";
import { SpaceSymbol } from "./space-symbol";

/** Application settings entry; creating and editing spaces never changes repositories on disk. */
export function SpacesSettings({
	spaces,
	activeId,
	onCreate,
	onEdit,
	onSelect,
}: {
	spaces: readonly WorkspaceSpace[];
	activeId: string;
	onCreate: () => void;
	onEdit: (space: WorkspaceSpace) => void;
	onSelect: (id: string) => void;
}) {
	const { tokens } = useAppTheme();

	return (
		<div
			testId="spaces-settings"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[4],
				padding: spacing[6],
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
			}}
		>
			<text
				role="heading"
				aria-level={1}
				style={{ ...typography.lg, color: tokens.colors.text }}
			>
				Spaces
			</text>
			<text style={{ ...typography.md, color: tokens.colors.textMuted }}>
				Keep separate repositories and tabs for each part of your day.
			</text>
			{spaces.map((space) => (
				<div
					key={space.id}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: spacing[3],
						maxWidth: 520,
					}}
				>
					<SpaceSymbol icon={space.icon} />
					<text
						style={{
							...typography.md,
							color: tokens.colors.text,
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
		</div>
	);
}

/** Shared editor for a space's name, symbol and repository membership. Drafts apply only on Save. */
export function SpaceManager({
	space,
	repositories,
	onSave,
	onClose,
}: {
	space?: WorkspaceSpace;
	repositories: readonly string[];
	onSave: (
		value: Pick<WorkspaceSpace, "name" | "icon" | "repositories">
	) => void;
	onClose: () => void;
}) {
	const machines = useContext(MachineContext);
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const previousFocus = useRef(renderer.getFocusedElementId?.());
	const [name, setName] = useState(space?.name ?? "");
	const [icon, setIcon] = useState(space?.icon ?? "work");

	const [selected, setSelected] = useState(
		() => new Set(space?.repositories ?? [])
	);

	const [query, setQuery] = useState("");
	const [error, setError] = useState<string>();

	const matches = [
		...new Set([...repositories, ...(space?.repositories ?? [])]),
	].filter((path) => path.toLowerCase().includes(query.toLowerCase()));

	const paths = matches.slice(0, 100);

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
	};

	const label = { ...typography.sm, color: tokens.colors.textMuted };

	const field = {
		...typography.md,
		height: 30,
		minWidth: 0,
		paddingLeft: spacing[2],
		paddingRight: spacing[2],
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.md,
		color: tokens.colors.text,
		backgroundColor: "transparent",
	};

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

		if (!WorkspaceSpaces.validIcon(icon)) {
			setError("Choose an icon or enter a single emoji.");

			return;
		}

		onSave({ name: name.trim(), icon, repositories: [...selected] });
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
				width={520}
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
						style={{ ...typography.lg, color: tokens.colors.text }}
					>
						{space ? "Edit space" : "New space"}
					</text>
					<text style={label}>Name</text>
					<input
						testId="space-name"
						aria-label="Space name"
						autoFocus
						tabIndex={0}
						value={name}
						placeholder="Work, Personal…"
						style={field}
						onChange={(event) => setName(event.value ?? "")}
						onKeyDown={(event) => {
							if (event.key === "enter") save();
						}}
					/>
					<text style={label}>Icon or emoji</text>
					<div style={row}>
						{spaceIcons.map((symbol) => (
							<Button
								key={symbol}
								tokens={tokens}
								size="sm"
								variant={icon === symbol ? "secondary" : "ghost"}
								aria-label={`${symbol} icon`}
								testId={`space-icon-${symbol}`}
								onPress={() => setIcon(symbol)}
								style={{
									width: 32,
									height: 32,
									paddingLeft: 0,
									paddingRight: 0,
								}}
							>
								<SpaceSymbol icon={symbol} />
							</Button>
						))}
						<input
							testId="space-emoji"
							aria-label="Custom space emoji"
							tabIndex={0}
							placeholder="💼"
							value={spaceIcons.some((symbol) => symbol === icon) ? "" : icon}
							style={{ ...field, width: 70 }}
							onChange={(event) => setIcon(event.value ?? "")}
						/>
					</div>
					<text
						style={label}
					>{`Repositories · ${selected.size} selected`}</text>
					<input
						testId="space-repository-search"
						aria-label="Find repositories for this space"
						tabIndex={0}
						placeholder="Find a repository…"
						value={query}
						style={field}
						onChange={(event) => setQuery(event.value ?? "")}
					/>
					<div
						testId="space-repositories"
						role="group"
						aria-label="Repositories in this space"
						style={{
							display: "flex",
							flexDirection: "column",
							height: 160,
							minHeight: 60,
							flexShrink: 1,
							overflowY: "scroll",
						}}
					>
						{paths.map((path) => {
							const remote = MachineLocation.parse(path);

							const description = remote
								? `${machines?.name(remote.machineId) ?? "SSH machine"} · ${remote.path}`
								: path;

							return (
								<div key={path} style={{ ...row, flexShrink: 0, height: 40 }}>
									<Checkbox
										tokens={tokens}
										testId={`space-repository-${path}`}
										aria-label={`Include ${path}`}
										checked={selected.has(path)}
										onCheckedChange={(checked) =>
											setSelected((current) => {
												const next = new Set(current);

												if (checked) next.add(path);
												else next.delete(path);

												return next;
											})
										}
									/>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											minWidth: 0,
											flexGrow: 1,
										}}
									>
										<text
											style={{
												...typography.md,
												color: tokens.colors.text,
												whiteSpace: "nowrap",
												textOverflow: "ellipsis",
											}}
										>
											{basename(path)}
										</text>
										<text
											style={{
												...label,
												whiteSpace: "nowrap",
												textOverflow: "ellipsis",
											}}
										>
											{description}
										</text>
									</div>
								</div>
							);
						})}
						{matches.length > paths.length ? (
							<text style={label}>
								Showing 100 matches. Type to narrow the list.
							</text>
						) : null}
						{!paths.length ? (
							<text style={label}>
								{query
									? "No matching repositories."
									: "Open a repository or add a folder from Home to fill this space."}
							</text>
						) : null}
					</div>
					{space ? (
						<text style={label}>
							Open tabs stay in this space. Your repositories stay on disk.
						</text>
					) : null}
					{error ? (
						<text
							role="alert"
							style={{ ...label, color: tokens.colors.danger }}
						>
							{error}
						</text>
					) : null}
					<div style={{ ...row, justifyContent: "flex-end" }}>
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

import { useState, useSyncExternalStore } from "react";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { spacing, typography, radius } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { Machines } from "./machines";
import { MachineSettings } from "./machine-settings";
import type { SavedMachine } from "./machine-store";
import type { MachineStatus } from "./ssh-connection";

const computer =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>';

const server =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="8" rx="2"/><rect x="4" y="13" width="16" height="8" rx="2"/><path d="M8 7h.01M8 17h.01m4-10h4m-4 10h4"/></svg>';

/** Compact Home switcher; connection setup and maintenance live in a separate dialog. */
export function MachinesPanel({
	service,
	selected,
	onSelect,
	onConnected,
}: {
	service: Machines;
	selected: string;
	onSelect: (id: string) => void;
	onConnected: () => void;
}) {
	const { tokens } = useAppTheme();

	useSyncExternalStore(service.subscribe, service.snapshot);
	const [managing, setManaging] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	let machines: readonly SavedMachine[] = [];
	let error: string | undefined;

	try {
		machines = service.list();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Could not load machines.";
	}

	const hint = { ...typography.xs, color: tokens.colors.textMuted };

	const icon = {
		width: 18,
		height: 18,
		flexShrink: 0,
		color: tokens.colors.textMuted,
		pointerEvents: "none" as const,
	};

	return (
		<div
			testId="machines-panel"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[1],
				marginBottom: spacing[6],
			}}
		>
			<text
				style={{ ...hint, marginLeft: spacing[2.5], marginBottom: spacing[2] }}
			>
				MACHINES
			</text>
			<Button
				tokens={tokens}
				variant={selected === "local" ? "secondary" : "ghost"}
				size="sm"
				testId="machine-local"
				aria-pressed={selected === "local"}
				style={{ justifyContent: "flex-start", gap: spacing[2.5], height: 38 }}
				onPress={() => onSelect("local")}
			>
				<svg source={computer} style={icon} />
				This Mac
			</Button>
			{machines.map((machine) => (
				<MachineRow
					key={machine.id}
					machine={machine}
					status={service.state(machine.id).status}
					selected={selected === machine.id}
					onSelect={onSelect}
					onManage={setManaging}
				/>
			))}
			<Button
				tokens={tokens}
				size="sm"
				variant="ghost"
				testId="machine-add"
				disabled={!!error}
				style={{
					justifyContent: "flex-start",
					gap: spacing[2.5],
					marginTop: spacing[1],
				}}
				onPress={() => setManaging("new")}
			>
				<WorkspaceTabIcon name="add" size={18} />
				Add machine…
			</Button>
			{error ? (
				<text role="alert" style={hint}>
					{error}
				</text>
			) : null}
			<Popover
				open={managing !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setManaging(null);
				}}
			>
				<PopoverContent
					testId="machine-settings"
					aria-label={
						managing === "new" ? "Add SSH machine" : "Machine settings"
					}
					placement="center"
					width={540}
					dismissible={!busy}
					tokens={tokens}
				>
					<MachineSettings
						service={service}
						machine={machines.find((machine) => machine.id === managing)}
						onBusy={setBusy}
						onSaved={setManaging}
						onSelect={onSelect}
						onForgotten={(id) => {
							if (id === selected) onSelect("local");
						}}
						onConnected={onConnected}
						onClose={() => setManaging(null)}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function MachineRow({
	machine,
	status,
	selected,
	onSelect,
	onManage,
}: {
	machine: SavedMachine;
	status: MachineStatus;
	selected: boolean;
	onSelect: (id: string) => void;
	onManage: (id: string) => void;
}) {
	const { tokens, colors } = useAppTheme();

	const [hoverTargets, setHoverTargets] = useState({
		row: false,
		open: false,
		manage: false,
	});

	const [focused, setFocused] = useState<"open" | "manage" | null>(null);

	const highlighted =
		Object.values(hoverTargets).some(Boolean) || focused !== null;

	const hint = { ...typography.xs, color: tokens.colors.textMuted };

	const icon = {
		width: 18,
		height: 18,
		flexShrink: 0,
		color: tokens.colors.textMuted,
		pointerEvents: "none" as const,
	};

	// Native hover events target each control separately; the row owns their shared background.
	const hoverEvents = (target: keyof typeof hoverTargets) => ({
		onMouseEnter: () =>
			setHoverTargets((current) => ({ ...current, [target]: true })),
		onMouseLeave: () =>
			setHoverTargets((current) => ({ ...current, [target]: false })),
	});

	const focusEvents = (target: "open" | "manage") => ({
		onFocus: () => setFocused(target),
		onBlur: () =>
			setFocused((current) => (current === target ? null : current)),
	});

	return (
		<div
			testId={`machine-row-${machine.id}`}
			{...hoverEvents("row")}
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				borderRadius: radius.md,
				backgroundColor:
					selected || highlighted ? tokens.colors.surface : "transparent",
			}}
		>
			<Button
				tokens={tokens}
				variant="ghost"
				size="sm"
				testId={`machine-${machine.id}`}
				{...hoverEvents("open")}
				{...focusEvents("open")}
				aria-label={`${machine.name}, ${status}`}
				aria-pressed={selected}
				style={{
					justifyContent: "flex-start",
					gap: spacing[2.5],
					height: 48,
					flexGrow: 1,
					flexBasis: 0,
					minWidth: 0,
					hover: { backgroundColor: "transparent" },
				}}
				onPress={() => onSelect(machine.id)}
			>
				<svg source={server} style={icon} />
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[0.5],
						flexGrow: 1,
						minWidth: 0,
					}}
				>
					<text
						style={{
							...typography.sm,
							color: tokens.colors.text,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
						}}
					>
						{machine.name}
					</text>
					<text
						style={{
							...hint,
							color:
								status === "Connected"
									? colors.success
									: tokens.colors.textMuted,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
						}}
					>
						{status}
					</text>
				</div>
			</Button>
			<Button
				tokens={tokens}
				variant="ghost"
				size="sm"
				testId={`machine-manage-${machine.id}`}
				{...hoverEvents("manage")}
				{...focusEvents("manage")}
				aria-label={`Manage ${machine.name}`}
				style={{
					width: 28,
					paddingLeft: 0,
					paddingRight: 0,
					marginRight: spacing[1],
				}}
				onPress={() => onManage(machine.id)}
			>
				<svg
					source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
					style={icon}
				/>
			</Button>
		</div>
	);
}

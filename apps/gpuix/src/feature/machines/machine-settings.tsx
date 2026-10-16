import { useEffect, useRef, useState } from "react";
import { useGpuixRequired } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { spacing, typography, radius, fontWeight } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { Machines } from "./machines";
import type { SavedMachine } from "./machine-store";

const fields = [
	{ key: "name", label: "Machine name", placeholder: "Devbox" },
	{ key: "host", label: "SSH host", placeholder: "devbox or host.example.com" },
	{
		key: "username",
		label: "Username (optional)",
		placeholder: "From SSH config",
	},
	{ key: "port", label: "Port (optional)", placeholder: "From SSH config" },
	{
		key: "identityFile",
		label: "Private key path (optional)",
		placeholder: "From SSH config or agent",
	},
	{
		key: "password",
		label: "Remember password / key passphrase (optional)",
		placeholder: "Otherwise ask when connecting",
	},
] as const;

/** Machine maintenance and SSH setup, shown only when explicitly opened from Home. */
export function MachineSettings({
	service,
	machine,
	onBusy,
	onSaved,
	onSelect,
	onForgotten,
	onConnected,
	onClose,
}: {
	service: Machines;
	machine?: SavedMachine;
	onBusy: (busy: boolean) => void;
	onSaved: (id: string) => void;
	onSelect: (id: string) => void;
	onForgotten: (id: string) => void;
	onConnected: () => void;
	onClose: () => void;
}) {
	const { tokens, colors } = useAppTheme();
	const renderer = useGpuixRequired();
	const [editing, setEditing] = useState(!machine);
	const [advanced, setAdvanced] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const mounted = useRef(true);
	const [folder, setFolder] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [aliases, setAliases] = useState<readonly string[]>([]);

	const [draft, setDraft] = useState({
		name: "",
		host: "",
		username: "",
		port: "",
		identityFile: "",
		password: "",
	});

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			onBusy(false);
		};
	}, [onBusy]);

	useEffect(() => {
		if (!editing) return;

		let active = true;

		void (async () => {
			try {
				const hosts = await Machines.aliases();

				if (active) setAliases(hosts);
			} catch (cause) {
				if (active)
					setError(
						cause instanceof Error ? cause.message : "Could not read SSH hosts."
					);
			}
		})();

		return () => {
			active = false;
		};
	}, [editing]);

	const run = async (operation: () => Promise<void>): Promise<void> => {
		if (busy.current) return;

		busy.current = true;
		setPending(true);
		onBusy(true);
		setError(null);

		try {
			await operation();
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not update this machine."
				);
		} finally {
			busy.current = false;

			if (mounted.current) {
				setPending(false);
				onBusy(false);
			}
		}
	};

	const hint = { ...typography.sm, color: tokens.colors.textMuted };

	const label = {
		...typography.sm,
		fontWeight: fontWeight.medium,
		color: tokens.colors.text,
	};

	const stack = {
		display: "flex",
		flexDirection: "column" as const,
		gap: spacing[3],
	};

	const row = {
		display: "flex",
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: spacing[2],
	};

	const section = {
		...stack,
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.lg,
		padding: spacing[4],
	};

	const input = {
		width: "100%",
		height: 34,
		...typography.sm,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: tokens.colors.border,
		color: tokens.colors.text,
		backgroundColor: tokens.colors.field,
	};

	const state = machine ? service.state(machine.id) : undefined;

	return (
		<div style={{ ...stack, gap: spacing[5], padding: spacing[4] }}>
			<div style={{ ...row, justifyContent: "space-between" }}>
				<div style={{ ...stack, gap: spacing[1], flexGrow: 1, minWidth: 0 }}>
					<text
						role="heading"
						aria-level={1}
						style={{
							...typography.lg,
							fontWeight: fontWeight.semibold,
							color: tokens.colors.text,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
						}}
					>
						{editing
							? machine
								? "Edit connection"
								: "Add SSH machine"
							: machine?.name}
					</text>
					<text style={hint}>
						{editing
							? "One connection for all your repositories."
							: "Manage this machine and where to look for repositories."}
					</text>
				</div>
				<Button
					testId="machine-settings-close"
					aria-label="Close machine settings"
					tokens={tokens}
					variant="ghost"
					size="sm"
					disabled={pending}
					style={{
						width: 28,
						paddingLeft: 0,
						paddingRight: 0,
						alignSelf: "flex-start",
					}}
					onPress={onClose}
				>
					<WorkspaceTabIcon name="close" />
				</Button>
			</div>
			{editing ? (
				<div testId="machine-connection-form" style={stack}>
					{aliases.length ? (
						<div style={{ ...stack, gap: spacing[2] }}>
							<text style={hint}>From your SSH config</text>
							<div style={{ ...row, flexWrap: "wrap" }}>
								{aliases.slice(0, 8).map((host) => (
									<Button
										key={host}
										tokens={tokens}
										size="sm"
										variant="secondary"
										testId={`ssh-alias-${host}`}
										disabled={pending}
										onPress={() =>
											setDraft((current) => ({
												...current,
												host,
												name: current.name || host,
											}))
										}
									>
										{host}
									</Button>
								))}
							</div>
						</div>
					) : null}
					{fields
						.filter(
							(field) =>
								advanced || field.key === "name" || field.key === "host"
						)
						.map((field) => (
							<div key={field.key} style={{ ...stack, gap: spacing[1.5] }}>
								<text style={label}>{field.label}</text>
								<input
									testId={`machine-${field.key}`}
									aria-label={field.label}
									type={field.key === "password" ? "password" : "text"}
									tabIndex={0}
									style={input}
									value={draft[field.key]}
									readOnly={pending}
									placeholder={field.placeholder}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											[field.key]: event.value ?? "",
										}))
									}
								/>
							</div>
						))}
					{advanced ? (
						<Button
							tokens={tokens}
							size="sm"
							variant="secondary"
							disabled={pending}
							style={{ alignSelf: "flex-start" }}
							onPress={() => {
								void run(async () => {
									const files = await renderer.promptForPaths?.({
										files: true,
										directories: false,
										multiple: false,
										prompt: "Choose SSH private key",
									});

									if (files?.[0] && mounted.current)
										setDraft((current) => ({
											...current,
											identityFile: files[0] ?? "",
										}));
								});
							}}
						>
							Choose key…
						</Button>
					) : null}
					<Button
						tokens={tokens}
						size="sm"
						variant="ghost"
						testId="machine-advanced"
						aria-expanded={advanced}
						disabled={pending}
						style={{ alignSelf: "flex-start", paddingLeft: 0 }}
						onPress={() => setAdvanced(!advanced)}
					>
						<WorkspaceTabIcon name={advanced ? "caretDown" : "caretRight"} />
						{advanced
							? "Hide connection options"
							: "Authentication and connection options"}
					</Button>
					<text style={hint}>
						Your SSH config, keys and agent work automatically. Remembered
						passwords stay in macOS Keychain. The remote helper is installed
						when you connect.
					</text>
				</div>
			) : machine ? (
				<>
					<div style={section}>
						<div style={{ ...row, justifyContent: "space-between" }}>
							<text role="heading" aria-level={2} style={label}>
								Connection
							</text>
							<Button
								tokens={tokens}
								variant="ghost"
								size="sm"
								testId="machine-edit"
								disabled={pending}
								onPress={() => {
									setDraft({
										name: machine.name,
										host: machine.host,
										username: machine.username,
										port: machine.port ? String(machine.port) : "",
										identityFile: machine.identityFile,
										password: "",
									});
									setError(null);
									setEditing(true);
								}}
							>
								Edit…
							</Button>
						</div>
						<text
							style={{ ...typography.md, color: tokens.colors.text }}
						>{`${machine.username ? `${machine.username}@` : ""}${machine.host}${machine.port ? `:${machine.port}` : ""}`}</text>
						<div
							style={{
								...row,
								justifyContent: "space-between",
								flexWrap: "wrap",
							}}
						>
							<text
								testId="machine-status"
								style={{
									...hint,
									color:
										state?.status === "Connected"
											? colors.success
											: tokens.colors.textMuted,
								}}
							>
								{state?.status}
							</text>
							<div style={row}>
								<Button
									tokens={tokens}
									size="sm"
									variant="secondary"
									testId="machine-reconnect"
									disabled={pending}
									onPress={() => {
										void run(async () => {
											await service.connect(machine.id);
											onConnected();
										});
									}}
								>
									{state?.status === "Connected" ? "Reconnect" : "Connect"}
								</Button>
								{state?.status === "Connected" ? (
									<Button
										tokens={tokens}
										size="sm"
										variant="ghost"
										testId="machine-disconnect"
										disabled={pending}
										onPress={() => {
											void run(async () => {
												await service.disconnect(machine.id);
											});
										}}
									>
										Disconnect
									</Button>
								) : null}
							</div>
						</div>
						{state?.error && state.error !== error ? (
							<text
								role="alert"
								style={{ ...hint, color: tokens.colors.danger }}
							>
								{state.error}
							</text>
						) : null}
					</div>
					<div style={section}>
						<text role="heading" aria-level={2} style={label}>
							Repository folders
						</text>
						<text style={hint}>
							Your home folder is scanned automatically. Add a specific folder
							to discover more repositories.
						</text>
						{machine.folders.map((path) => (
							<div key={path} style={row}>
								<text
									style={{
										...hint,
										flexGrow: 1,
										flexShrink: 1,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{path}
								</text>
								<Button
									tokens={tokens}
									size="sm"
									variant="ghost"
									testId={`machine-remove-folder-${path}`}
									aria-label={`Remove scan folder ${path}`}
									disabled={pending}
									style={{ width: 28, paddingLeft: 0, paddingRight: 0 }}
									onPress={() => {
										void run(async () => {
											await service.save({
												...machine,
												folders: machine.folders.filter(
													(item) => item !== path
												),
											});
										});
									}}
								>
									<WorkspaceTabIcon name="close" />
								</Button>
							</div>
						))}
						<div style={row}>
							<input
								testId="machine-scan-folder"
								aria-label="Remote scan folder"
								tabIndex={0}
								style={{ ...input, flexGrow: 1, flexBasis: 0, minWidth: 0 }}
								value={folder}
								readOnly={pending}
								placeholder="/home/me/projects"
								onChange={(event) => setFolder(event.value ?? "")}
							/>
							<Button
								tokens={tokens}
								size="sm"
								variant="secondary"
								testId="machine-add-folder"
								disabled={
									pending ||
									!folder.trim() ||
									machine.folders.includes(folder.trim())
								}
								onPress={() => {
									void run(async () => {
										await service.save({
											...machine,
											folders: [...machine.folders, folder.trim()],
										});

										if (mounted.current) setFolder("");
									});
								}}
							>
								Add folder
							</Button>
						</div>
					</div>
				</>
			) : null}
			{error ? (
				<text
					role="alert"
					testId="machine-settings-error"
					style={{ ...hint, color: tokens.colors.danger }}
				>
					{error}
				</text>
			) : null}
			{removing ? (
				<text style={hint}>
					Forget this machine and its saved credentials? Your remote
					repositories stay on the machine.
				</text>
			) : null}
			<div
				style={{
					...row,
					justifyContent: "space-between",
					borderTopWidth: 1,
					borderColor: tokens.colors.border,
					paddingTop: spacing[4],
				}}
			>
				{machine && !editing ? (
					<Button
						tokens={tokens}
						size="sm"
						variant="ghost"
						testId="machine-forget"
						disabled={pending}
						textStyle={{ color: tokens.colors.danger }}
						onPress={() => {
							if (!removing) {
								setRemoving(true);

								return;
							}

							void run(async () => {
								await service.remove(machine.id);
								onForgotten(machine.id);
								onClose();
							});
						}}
					>
						{removing ? "Confirm forget" : "Forget machine…"}
					</Button>
				) : (
					<div />
				)}
				<div style={row}>
					{editing || removing ? (
						<Button
							tokens={tokens}
							size="sm"
							variant="ghost"
							testId="machine-cancel"
							disabled={pending}
							onPress={() => {
								setDraft((current) => ({ ...current, password: "" }));
								setError(null);

								if (removing) setRemoving(false);
								else if (machine) setEditing(false);
								else onClose();
							}}
						>
							Cancel
						</Button>
					) : null}
					{editing ? (
						<Button
							tokens={tokens}
							testId="machine-connect"
							size="sm"
							disabled={pending || !draft.host.trim()}
							onPress={() => {
								void run(async () => {
									const next: SavedMachine = {
										id: machine?.id ?? crypto.randomUUID(),
										name: draft.name.trim() || draft.host.trim(),
										host: draft.host.trim(),
										username: draft.username.trim(),
										port: draft.port.trim() ? Number(draft.port) : null,
										identityFile: draft.identityFile.trim(),
										folders: machine?.folders ?? [],
									};

									await service.save(next, draft.password);

									if (!mounted.current) return;

									setDraft((current) => ({ ...current, password: "" }));
									setEditing(false);
									onSaved(next.id);
									onSelect(next.id);
									await service.connect(next.id);

									if (mounted.current) onConnected();
								});
							}}
						>
							{pending ? "Connecting…" : "Save and connect"}
						</Button>
					) : !removing ? (
						<Button
							tokens={tokens}
							testId="machine-done"
							size="sm"
							disabled={pending}
							onPress={onClose}
						>
							Done
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

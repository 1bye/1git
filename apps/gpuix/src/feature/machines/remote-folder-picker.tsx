import { useContext, useEffect, useRef, useState } from "react";
import { posix } from "node:path";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { spacing, typography, radius } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { MachineContext } from "./machine-context";
import { Machines } from "./machines";
import { MachineLocation } from "./machine-location";
import type { MachineDirectory } from "./machine-folders";

/** Small remote folder chooser. Browsing is read-only; a new destination is created only by the caller's final Git action. */
export function RemoteFolderPicker({
	location,
	title,
	initialName,
	onSelect,
	onClose,
	confirmLabel = "Choose folder",
}: {
	location: string;
	title: string;
	/** When present, allows a future child folder, including an initially empty name. */
	initialName?: string;
	confirmLabel?: string;
	onSelect: (location: string) => void;
	onClose: () => void;
}) {
	const service = useContext(MachineContext) ?? Machines.shared;
	const machine = MachineLocation.parse(location);
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const [current, setCurrent] = useState(location);
	const [draft, setDraft] = useState(MachineLocation.display(location));
	const [hidden, setHidden] = useState(false);
	const [name, setName] = useState(initialName ?? "");
	const [listing, setListing] = useState<MachineDirectory | null>(null);
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [revision, setRevision] = useState(0);
	const rows = useRef(new Map<string, PublicInstance>());
	const viewport = useRef<PublicInstance>(null);
	const previousFocus = useRef(renderer.getFocusedElementId?.());

	useEffect(
		() => () => {
			if (previousFocus.current != null)
				renderer.focusElement?.(previousFocus.current);
		},
		[renderer]
	);
	const machineName = machine ? service.name(machine.machineId) : "SSH machine";
	const hint = { ...typography.sm, color: tokens.colors.textMuted };

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
	};

	const input = {
		...typography.md,
		height: 30,
		minWidth: 0,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: tokens.colors.border,
		color: tokens.colors.text,
		backgroundColor: "transparent",
	};

	useEffect(() => {
		const controller = new AbortController();

		setLoading(true);
		setListing(null);
		setError(undefined);
		const read = async () => {
			try {
				const result = await service.listDirectory(
					current,
					hidden,
					controller.signal
				);

				if (!controller.signal.aborted) {
					setListing(result);
					setDraft(MachineLocation.display(result.path));

					if (viewport.current) renderer.scrollTo?.(viewport.current.id, 0, 0);
				}
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not list this folder."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		};

		void read();

		return () => controller.abort();
	}, [current, hidden, revision, service, renderer]);

	const navigate = (path: string) => {
		setDraft(MachineLocation.display(path));
		setListing(null);
		setCurrent(path);
		setRevision((value) => value + 1);
	};

	const go = () => {
		try {
			if (!machine || MachineLocation.isRemote(draft))
				throw new Error("Enter an absolute folder path on this machine.");

			navigate(MachineLocation.encode(machine.machineId, draft));
		} catch {
			setError("Enter an absolute folder path on this machine.");
		}
	};

	const childName = name.trim();

	const pathEdited =
		listing !== null && draft !== MachineLocation.display(listing.path);

	const invalidName =
		!!childName &&
		(childName === "." ||
			childName === ".." ||
			childName.includes("/") ||
			/[\0\r\n]/.test(childName));

	const choose = () => {
		if (!listing || loading || error || invalidName || pathEdited || !machine)
			return;

		onSelect(
			childName
				? MachineLocation.encode(
						machine.machineId,
						posix.join(MachineLocation.display(listing.path), childName)
					)
				: listing.path
		);
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
				width={560}
				testId="remote-folder-picker"
				aria-label={`${title} on ${machineName}`}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[3],
						minHeight: 0,
					}}
				>
					<div style={{ ...row, justifyContent: "space-between" }}>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[1],
							}}
						>
							<text style={{ ...typography.lg, color: tokens.colors.text }}>
								{title}
							</text>
							<text style={hint}>{machineName}</text>
						</div>
						<Button
							tokens={tokens}
							variant="ghost"
							size="sm"
							aria-label="Close folder browser"
							onPress={onClose}
						>
							<WorkspaceTabIcon name="close" />
						</Button>
					</div>
					<div style={row}>
						<Button
							tokens={tokens}
							variant="ghost"
							size="sm"
							testId="remote-folder-home"
							aria-label="Home folder"
							style={{ height: input.height }}
							disabled={!machine}
							onPress={() => {
								if (machine)
									navigate(
										MachineLocation.encode(
											machine.machineId,
											service.home(machine.machineId) ?? "/"
										)
									);
							}}
						>
							<WorkspaceTabIcon name="home" />
						</Button>
						<Button
							tokens={tokens}
							variant="ghost"
							size="sm"
							testId="remote-folder-up"
							aria-label="Parent folder"
							style={{ height: input.height }}
							disabled={!listing || listing.path === listing.parent}
							onPress={() => {
								if (listing) navigate(listing.parent);
							}}
						>
							<WorkspaceTabIcon name="push" />
						</Button>
						<input
							testId="remote-folder-path"
							aria-label="Remote folder path"
							tabIndex={0}
							value={draft}
							style={{ ...input, flexGrow: 1 }}
							onChange={(event) => setDraft(event.value ?? "")}
							onKeyDown={(event) => {
								if (event.key === "enter") go();
							}}
						/>
						<Button
							tokens={tokens}
							variant="secondary"
							size="sm"
							testId="remote-folder-go"
							style={{ height: input.height }}
							onPress={go}
						>
							Go
						</Button>
					</div>
					<div
						ref={viewport}
						testId="remote-folder-list"
						role="group"
						aria-label="Folders"
						style={{
							display: "flex",
							flexDirection: "column",
							height: 220,
							minHeight: 80,
							flexShrink: 1,
							overflowY: "scroll",
							borderWidth: 1,
							borderRadius: radius.md,
							borderColor: tokens.colors.border,
							padding: spacing[1],
						}}
					>
						{loading ? (
							<text role="status" style={{ ...hint, padding: spacing[2] }}>
								Loading folders…
							</text>
						) : error ? (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[2],
									padding: spacing[2],
								}}
							>
								<text role="alert" testId="remote-folder-error" style={hint}>
									{error}
								</text>
								<Button
									tokens={tokens}
									variant="secondary"
									size="sm"
									testId="remote-folder-retry"
									onPress={() => setRevision((value) => value + 1)}
								>
									Retry
								</Button>
							</div>
						) : listing?.entries.length ? (
							listing.entries.map((entry, index) => (
								<Button
									key={entry.path}
									ref={(element) => {
										if (element) rows.current.set(entry.path, element);
										else rows.current.delete(entry.path);
									}}
									tokens={tokens}
									variant="ghost"
									size="sm"
									testId={`remote-folder-${entry.name}`}
									aria-label={`Open folder ${entry.name}`}
									onPress={() => navigate(entry.path)}
									onKeyDown={(event) => {
										if (event.key !== "up" && event.key !== "down") return;

										const target = Math.max(
											0,
											Math.min(
												listing.entries.length - 1,
												index + (event.key === "up" ? -1 : 1)
											)
										);

										const entry = listing.entries[target];
										const element = entry && rows.current.get(entry.path);

										if (element) renderer.focusElement?.(element.id);

										if (viewport.current)
											renderer.scrollTo?.(
												viewport.current.id,
												0,
												-Math.max(0, target - 2) * 32
											);
									}}
									style={{
										...row,
										height: 32,
										flexShrink: 0,
										justifyContent: "flex-start",
										width: "100%",
									}}
								>
									<svg
										source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M3 7V5h6l3 3h9v12H3Z"/></svg>'
										style={{
											width: 16,
											height: 16,
											flexShrink: 0,
											color: tokens.colors.textMuted,
											pointerEvents: "none",
										}}
									/>
									<text
										style={{
											...typography.md,
											color: tokens.colors.text,
											minWidth: 0,
											flexGrow: 1,
											whiteSpace: "nowrap",
											textOverflow: "ellipsis",
											pointerEvents: "none",
										}}
									>
										{entry.name}
									</text>
									<WorkspaceTabIcon name="caretRight" />
								</Button>
							))
						) : (
							<text style={{ ...hint, padding: spacing[2] }}>
								No folders here.
							</text>
						)}
					</div>
					<div style={{ ...row, justifyContent: "space-between" }}>
						<Button
							tokens={tokens}
							variant={hidden ? "secondary" : "ghost"}
							size="sm"
							testId="remote-folder-hidden"
							aria-pressed={hidden}
							onPress={() => setHidden((value) => !value)}
						>
							{hidden ? "Hide hidden folders" : "Show hidden folders"}
						</Button>
						{listing?.limited ? (
							<text style={hint}>
								Showing a limited list. Enter a path to find more folders.
							</text>
						) : null}
					</div>
					{initialName !== undefined ? (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[1],
							}}
						>
							<text style={hint}>New folder (optional)</text>
							<input
								testId="remote-folder-name"
								aria-label="New destination folder name"
								tabIndex={0}
								value={name}
								placeholder="Use this folder, or enter a new folder name"
								style={{ ...input, width: "100%" }}
								onChange={(event) => setName(event.value ?? "")}
								onKeyDown={(event) => {
									if (event.key === "enter") choose();
								}}
							/>
							{invalidName ? (
								<text role="alert" style={hint}>
									Enter one folder name without slashes.
								</text>
							) : null}
						</div>
					) : null}
					<div style={{ ...row, justifyContent: "flex-end" }}>
						<Button
							tokens={tokens}
							variant="secondary"
							size="sm"
							testId="remote-folder-cancel"
							onPress={onClose}
						>
							Cancel
						</Button>
						<Button
							tokens={tokens}
							size="sm"
							testId="remote-folder-select"
							disabled={
								!listing || loading || !!error || invalidName || pathEdited
							}
							onPress={choose}
						>
							{confirmLabel}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

import { homedir } from "node:os";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { motion, useGpuixRequired } from "@gpuix/react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from "@1git/gpuix-ui/popover";
import { appTokens } from "../../../styles/tokens";
import {
	RepositorySetup,
	type RepositorySetupRequest,
	type RepositorySetupResult,
} from "../lib/repository-setup";

const styles = StyleSheet.create({
	form: { display: "flex", flexDirection: "column", gap: 12, paddingBottom: 4 },
	field: { display: "flex", flexDirection: "column", gap: 4 },
	label: { fontSize: 12, color: appTokens.colors.text },
	hint: { fontSize: 11, color: appTokens.colors.textMuted },
	input: {
		height: 30,
		width: "100%",
		fontSize: 12,
		paddingLeft: 9,
		paddingRight: 9,
		borderRadius: 6,
		borderWidth: 1,
		borderColor: appTokens.colors.border,
		color: appTokens.colors.text,
		backgroundColor: "transparent",
	},
	row: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6 },
});

function SetupProgress() {
	const [bright, setBright] = useState(false);

	useEffect(() => {
		const timer = setInterval(() => setBright((value) => !value), 700);

		return () => clearInterval(timer);
	}, []);

	return (
		<div
			role="progressbar"
			aria-label="Repository setup in progress"
			style={{ height: 3, flexShrink: 0 }}
		>
			<motion.div
				animate={{ opacity: bright ? 1 : 0.3 }}
				transition={{ duration: 0.7 }}
				style={{
					height: 3,
					width: "100%",
					borderRadius: 2,
					backgroundColor: appTokens.colors.focusRing,
				}}
			/>
		</div>
	);
}

/** Anchored setup forms; window-owned writes survive component unmount and keep close protection active. */
export function RepositorySetupActions({
	disabled,
	onSubmit,
	onCancel,
	onOpen,
}: {
	disabled: boolean;
	onSubmit: (request: RepositorySetupRequest) => Promise<RepositorySetupResult>;
	onCancel: () => void;
	onOpen: (path: string) => void;
}) {
	return (
		<div style={styles.row}>
			{(["clone", "create"] as const).map((kind) => (
				<SetupForm
					key={kind}
					kind={kind}
					disabled={disabled}
					onSubmit={onSubmit}
					onCancel={onCancel}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

function SetupForm({
	kind,
	disabled,
	onSubmit,
	onCancel,
	onOpen,
}: Parameters<typeof RepositorySetupActions>[0] & {
	kind: "clone" | "create";
}) {
	const renderer = useGpuixRequired();
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [branch, setBranch] = useState("main");
	const [selectedPath, setSelectedPath] = useState<string>();
	const [picking, setPicking] = useState(false);
	const [busy, setBusy] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState<string>();
	const [openPath, setOpenPath] = useState<string>();
	const working = useRef(false);
	const mounted = useRef(true);
	const clone = kind === "clone";

	const path =
		selectedPath ??
		(clone && url.trim()
			? join(homedir(), RepositorySetup.folderName(url))
			: "");

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);

	const clearError = () => {
		setError(undefined);
		setOpenPath(undefined);
	};

	const chooseLocation = async () => {
		if (working.current || picking) return;

		setPicking(true);

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable.");

			const paths = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: clone
					? "Choose empty clone folder"
					: "Choose repository folder",
			});

			if (mounted.current && paths?.[0]) {
				setSelectedPath(paths[0]);
				clearError();
			}
		} catch {
			if (mounted.current) setError("Could not open the folder picker.");
		} finally {
			if (mounted.current) setPicking(false);
		}
	};

	const submit = async () => {
		if (
			working.current ||
			disabled ||
			picking ||
			!path ||
			!(clone ? url.trim() : branch.trim())
		)
			return;

		if (openPath) {
			onOpen(openPath);
			setOpen(false);

			return;
		}

		working.current = true;
		setBusy(true);
		setStopping(false);
		clearError();

		try {
			const result = await onSubmit(
				clone
					? { kind, path, remoteUrl: url.trim() }
					: { kind, path, branch: branch.trim() }
			);

			if (!mounted.current) return;

			if (result.ok) setOpen(false);
			else {
				setError(result.message);
				setOpenPath(result.openPath);
			}
		} catch {
			if (mounted.current)
				setError(
					"Setup did not finish. Review the destination before retrying."
				);
		} finally {
			working.current = false;

			if (mounted.current) {
				setBusy(false);
				setStopping(false);
			}
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (!working.current && !picking) setOpen(next);
			}}
			modal
		>
			<PopoverTrigger asChild>
				<Button
					tokens={appTokens}
					variant="ghost"
					size="sm"
					testId={`repository-${kind}`}
					disabled={disabled}
				>
					{clone ? "Clone repository" : "Create new"}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				tokens={appTokens}
				width={340}
				align="center"
				aria-label={clone ? "Clone repository" : "Create repository"}
				dismissible={!busy && !picking}
			>
				<div style={styles.form}>
					<text style={styles.label}>
						{clone ? "Clone repository" : "Create repository"}
					</text>
					{busy ? (
						<>
							<text testId="setup-progress" role="status" style={styles.hint}>
								{stopping
									? "Stopping…"
									: clone
										? "Cloning repository…"
										: "Creating repository…"}
							</text>
							<SetupProgress />
						</>
					) : (
						<>
							{clone ? (
								<div style={styles.field}>
									<text style={styles.hint}>Repository URL</text>
									<input
										testId="setup-url"
										aria-label="Repository URL"
										tabIndex={0}
										style={styles.input}
										value={url}
										placeholder="https://github.com/owner/project.git"
										onChange={(event) => {
											setUrl(event.value ?? "");
											clearError();
										}}
									/>
								</div>
							) : null}
							<div style={styles.field}>
								<text style={styles.hint}>Location</text>
								<Button
									tokens={appTokens}
									variant="ghost"
									size="sm"
									testId="setup-location"
									aria-label={path || "Choose repository folder"}
									disabled={picking}
									style={{
										...styles.input,
										...styles.row,
										justifyContent: "flex-start",
										hover: { backgroundColor: "transparent" },
									}}
									onPress={() => {
										void chooseLocation();
									}}
								>
									<svg
										source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
										style={{
											width: 14,
											height: 14,
											flexShrink: 0,
											color: appTokens.colors.textMuted,
											pointerEvents: "none",
										}}
									/>
									<text
										style={{
											...styles.label,
											minWidth: 0,
											flexShrink: 1,
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											pointerEvents: "none",
										}}
									>
										{picking ? "Choosing…" : path || "Choose folder…"}
									</text>
								</Button>
							</div>
							{!clone ? (
								<div style={styles.field}>
									<text style={styles.hint}>Initial branch</text>
									<input
										testId="setup-branch"
										aria-label="Initial branch"
										tabIndex={0}
										style={styles.input}
										value={branch}
										onChange={(event) => {
											setBranch(event.value ?? "");
											clearError();
										}}
									/>
								</div>
							) : null}
						</>
					)}
					{error ? (
						<text testId="setup-error" role="alert" style={styles.hint}>
							{error}
						</text>
					) : null}
					<div style={{ ...styles.row, justifyContent: "flex-end" }}>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="setup-cancel"
							disabled={picking || stopping}
							onPress={() => {
								if (working.current) {
									setStopping(true);
									onCancel();
								} else setOpen(false);
							}}
						>
							{stopping ? "Stopping…" : "Cancel"}
						</Button>
						{!busy ? (
							<Button
								tokens={appTokens}
								size="sm"
								testId="setup-submit"
								disabled={
									disabled ||
									picking ||
									!path ||
									!(clone ? url.trim() : branch.trim())
								}
								onPress={() => {
									void submit();
								}}
							>
								{openPath
									? "Open repository"
									: error
										? "Retry"
										: clone
											? "Clone"
											: "Create & open"}
							</Button>
						) : null}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

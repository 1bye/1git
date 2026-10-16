import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { typography, radius, spacing, iconSize } from "@1git/design-tokens";
import { useEffect, useRef, useState, type Ref } from "react";
import { motion, useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from "@1git/gpuix-ui/popover";

import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";
import { StateArtwork } from "../../../fixture/state-artwork";
import type {
	RepositorySetupRequest,
	RepositorySetupResult,
} from "../lib/repository-setup";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const hint = { ...typography.sm, color: appTokens.colors.textMuted };

	const input = {
		height: 30,
		width: "100%",
		...typography.md,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: appTokens.colors.border,
		color: appTokens.colors.text,
		backgroundColor: "transparent",
	};

	return { hint, input };
});

const row = {
	display: "flex",
	flexDirection: "row",
	alignItems: "center",
	gap: spacing[1.5],
};

/** Shared indeterminate progress; Git does not stream percentages at this boundary. */
export function SetupProgress() {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

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
					borderRadius: radius.xs,
					backgroundColor: appTokens.colors.focusRing,
				}}
			/>
		</div>
	);
}

/** Create stays compact; Clone opens a workspace-sized view in the requesting tab. */
export function RepositorySetupActions({
	disabled,
	onSubmit,
	onCancel,
	onOpen,
	onBegin,
	onClone,
	cloneRef,
	presentation = "list",
	testIdPrefix = "",
}: {
	disabled: boolean;
	onSubmit: (request: RepositorySetupRequest) => Promise<RepositorySetupResult>;
	onCancel: () => void;
	onOpen: (path: string) => void;
	onBegin: () => void;
	onClone: () => void;
	cloneRef?: Ref<PublicInstance>;
	presentation?: "list" | "tiles";
	testIdPrefix?: string;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: presentation === "tiles" ? "row" : "column",
				gap: spacing[1],
				flexGrow: presentation === "tiles" ? 2 : undefined,
				flexBasis: presentation === "tiles" ? 0 : undefined,
				minWidth: 0,
			}}
		>
			<CreateForm
				testIdPrefix={testIdPrefix}
				presentation={presentation}
				disabled={disabled}
				onSubmit={onSubmit}
				onCancel={onCancel}
				onOpen={onOpen}
				onBegin={onBegin}
			/>
			<Button
				ref={cloneRef}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				testId={`${testIdPrefix}repository-clone`}
				disabled={disabled}
				style={{
					width: presentation === "tiles" ? undefined : "100%",
					flexGrow: presentation === "tiles" ? 1 : undefined,
					flexBasis: presentation === "tiles" ? 0 : undefined,
					minWidth: 0,
					height:
						presentation === "tiles" ? 88 : appTokens.layout.smallControlHeight,
					flexDirection: presentation === "tiles" ? "column" : "row",
					justifyContent: presentation === "tiles" ? "center" : "flex-start",
					borderColor:
						presentation === "tiles" ? appTokens.colors.border : "transparent",
					gap: presentation === "tiles" ? spacing[2] : spacing[2.5],
					color: appTokens.colors.textMuted,
				}}
				onPress={onClone}
			>
				<WorkspaceTabIcon
					name="branch"
					size={presentation === "tiles" ? iconSize.sm : iconSize.lg}
				/>
				Clone repository
			</Button>
		</div>
	);
}

function CreateForm({
	disabled,
	onSubmit,
	onCancel,
	onOpen,
	onBegin,
	presentation = "list",
	testIdPrefix = "",
}: Omit<Parameters<typeof RepositorySetupActions>[0], "onClone">) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { hint, input } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const [open, setOpen] = useState(false);
	const [branch, setBranch] = useState("main");
	const [path, setPath] = useState("");
	const [picking, setPicking] = useState(false);
	const [busy, setBusy] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState<string>();
	const [openPath, setOpenPath] = useState<string>();
	const working = useRef(false);
	const mounted = useRef(true);

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
				prompt: "Choose repository folder",
			});

			if (mounted.current && paths?.[0]) {
				setPath(paths[0]);
				clearError();
			}
		} catch {
			if (mounted.current) setError("Could not open the folder picker.");
		} finally {
			if (mounted.current) setPicking(false);
		}
	};

	const submit = async () => {
		if (working.current || disabled || picking || !path || !branch.trim())
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
			const result = await onSubmit({
				kind: "create",
				path,
				branch: branch.trim(),
			});

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
				if (!working.current && !picking) {
					if (next) onBegin();

					setOpen(next);
				}
			}}
			modal
		>
			<PopoverTrigger asChild>
				<Button
					tokens={appTokens}
					variant="ghost"
					size="sm"
					testId={`${testIdPrefix}repository-create`}
					disabled={disabled}
					style={{
						width: presentation === "tiles" ? undefined : "100%",
						flexGrow: presentation === "tiles" ? 1 : undefined,
						flexBasis: presentation === "tiles" ? 0 : undefined,
						minWidth: 0,
						height:
							presentation === "tiles"
								? 88
								: appTokens.layout.smallControlHeight,
						flexDirection: presentation === "tiles" ? "column" : "row",
						justifyContent: presentation === "tiles" ? "center" : "flex-start",
						borderColor:
							presentation === "tiles"
								? appTokens.colors.border
								: "transparent",
						gap: presentation === "tiles" ? spacing[2] : spacing[2.5],
						color: appTokens.colors.textMuted,
					}}
				>
					<WorkspaceTabIcon
						name="add"
						size={presentation === "tiles" ? iconSize.sm : iconSize.lg}
					/>
					Create repository
				</Button>
			</PopoverTrigger>
			<PopoverContent
				tokens={appTokens}
				width={340}
				align="center"
				aria-label="Create repository"
				dismissible={!busy && !picking}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[3],
						paddingBottom: spacing[1],
					}}
				>
					<text style={{ ...typography.md, color: appTokens.colors.text }}>
						Create repository
					</text>
					{busy ? (
						<>
							<div style={{ display: "flex", alignItems: "center" }}>
								<StateArtwork name="repository" compact />
							</div>
							<text testId="setup-progress" role="status" style={hint}>
								{stopping ? "Stopping…" : "Creating repository…"}
							</text>
							<SetupProgress />
						</>
					) : (
						<>
							<div style={{ gap: spacing[1] }}>
								<text style={hint}>Location</text>
								<Button
									tokens={appTokens}
									variant="ghost"
									size="sm"
									testId="setup-location"
									aria-label={path || "Choose repository folder"}
									disabled={picking}
									style={{
										...input,
										...row,
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
											width: iconSize.sm,
											height: iconSize.sm,
											flexShrink: 0,
											color: appTokens.colors.textMuted,
											pointerEvents: "none",
										}}
									/>
									<text
										style={{
											...typography.md,
											color: appTokens.colors.text,
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
							<div style={{ gap: spacing[1] }}>
								<text style={hint}>Initial branch</text>
								<input
									testId="setup-branch"
									aria-label="Initial branch"
									tabIndex={0}
									style={input}
									value={branch}
									onChange={(event) => {
										setBranch(event.value ?? "");
										clearError();
									}}
								/>
							</div>
						</>
					)}
					{error ? (
						<text testId="setup-error" role="alert" style={hint}>
							{error}
						</text>
					) : null}
					<div style={{ ...row, justifyContent: "flex-end" }}>
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
								disabled={disabled || picking || !path || !branch.trim()}
								onPress={() => {
									void submit();
								}}
							>
								{openPath
									? "Open repository"
									: error
										? "Retry"
										: "Create & open"}
							</Button>
						) : null}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

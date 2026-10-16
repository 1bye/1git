import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, radius, iconSize } from "@1git/design-tokens";
import { basename, dirname, join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	Combobox,
	ComboboxInput,
	ComboboxTrigger,
	ComboboxContent,
	ComboboxItem,
} from "@gpuix/react/combobox";

import {
	RepositoryBranches,
	type WorkspaceBranches,
} from "../lib/repository-branches";
import {
	RepositoryWorktrees,
	type WorktreeChoice,
} from "../lib/repository-worktrees";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import { WorkspaceMenuModel } from "../lib/workspace-menu-model";

const folderUnsafeCharacters = /[^\p{L}\p{N}._-]+/gu;

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const { colors } = appTokens;

	const styles = StyleSheet.create({
		form: {
			display: "flex",
			flexDirection: "column",
			gap: spacing[2.5],
			padding: spacing[2],
			minHeight: 0,
			overflowY: "scroll",
		},
		label: { ...typography.md, color: colors.text },
		field: {
			display: "flex",
			flexDirection: "column",
			gap: spacing[1],
			flexShrink: 0,
		},
		comboInput: {
			width: 0,
			minWidth: 0,
			flexGrow: 1,
			flexShrink: 1,
			borderWidth: 0,
			paddingLeft: spacing[0],
			paddingRight: spacing[0],
			height: 28,
		},
		comboTrigger: {
			width: 20,
			height: 28,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			cursor: "pointer",
		},
		options: {
			width: 264,
			maxHeight: 160,
			overflowY: "scroll",
			padding: spacing[1],
			display: "flex",
			flexDirection: "column",
			backgroundColor: colors.overlay,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: colors.border,
		},
		option: {
			minHeight: 28,
			paddingLeft: spacing[2],
			paddingRight: spacing[2],
			display: "flex",
			alignItems: "center",
			gap: spacing[2],
			...typography.md,
			color: colors.text,
			borderRadius: radius.sm,
			cursor: "pointer",
		},
		fieldText: {
			...typography.md,
			minWidth: 0,
			flexGrow: 1,
			flexShrink: 1,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			pointerEvents: "none",
		},
		locationField: {
			display: "flex",
			alignItems: "center",
			gap: spacing[2],
			justifyContent: "flex-start",
		},
		hint: {
			...typography.sm,
			color: colors.textMuted,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			minWidth: 0,
		},
		input: {
			height: 30,
			flexShrink: 0,
			width: "100%",
			...typography.md,
			paddingLeft: spacing[2.5],
			paddingRight: spacing[2.5],
			borderRadius: radius.md,
			backgroundColor: "transparent",
			color: colors.text,
			borderWidth: 1,
			borderColor: colors.border,
			hover: { backgroundColor: "transparent" },
		},
		footer: {
			display: "flex",
			justifyContent: "space-between",
			flexShrink: 0,
			gap: spacing[1.5],
		},
	});

	return { colors, styles };
});

/** Destination selection stays local; the window owns the non-cancellable Git write. */
export function WorkspaceWorktreeForm({
	root,
	data,
	busy,
	onCancel,
	onCreate,
	onError,
}: {
	root: string;
	data: WorkspaceBranches;
	busy: boolean;
	onCancel: () => void;
	onCreate: (choice: WorktreeChoice) => Promise<void>;
	onError: (message: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { colors, styles } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const [name, setName] = useState("");
	const branchInput = useRef<PublicInstance>(null);
	const [selectedPath, setSelectedPath] = useState<string>();
	const [picking, setPicking] = useState(false);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;

		if (branchInput.current) renderer.focusElement?.(branchInput.current.id);

		return () => {
			mounted.current = false;
		};
	}, [renderer]);
	const disabled = busy || picking;

	const branches = [
		...data.branches.branches.filter((item) => item.type === "local"),
		...WorkspaceMenuModel.untrackedRemoteBranches(data.branches),
	].map((item) => ({
		item,
		value:
			item.type === "remote" &&
			data.branches.branches.some(
				(local) => local.type === "local" && local.name === item.name
			)
				? `${item.name} (remote)`
				: item.name,
	}));

	const branch = name.trim();
	const existing = branches.find((choice) => choice.value === branch)?.item;
	const remote = existing?.type === "remote" ? existing : null;

	const remoteTarget = remote
		? RepositoryBranches.remoteTarget(remote, data.branches)
		: null;

	const occupied =
		!!existing && (existing.checkedOut || !!existing.worktreePath);

	const branchError = remoteTarget
		? remoteTarget.error
		: RepositoryWorktrees.branchNameError(branch);

	const matches = branches.filter((choice) =>
		choice.value.toLowerCase().includes(branch.toLowerCase())
	);

	const suggestions = matches.map((choice) => choice.value);

	if (branch && !existing && !branchError) suggestions.push(branch);

	const help = occupied
		? branch === data.branches.current
			? "Already used by this workspace."
			: "Already open in another worktree."
		: (branchError ??
			(remoteTarget
				? `Creates “${remoteTarget.name}” tracking ${remote?.name}.`
				: existing
					? "Uses existing branch."
					: branch
						? `Creates a new branch from ${data.branches.current ?? "HEAD"}.`
						: "Choose an existing branch or enter a new name."));

	const suffix = basename(branch || "worktree").replace(
		folderUnsafeCharacters,
		"-"
	);

	const path =
		selectedPath ?? join(dirname(root), `${basename(root)}-${suffix}`);

	const canCreate = !disabled && !!branch && !occupied && !branchError;

	const chooseLocation = async (): Promise<void> => {
		setPicking(true);

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable on this platform.");

			const paths = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: "Choose worktree folder",
			});

			if (mounted.current && paths?.[0]) setSelectedPath(paths[0]);
		} catch {
			if (mounted.current) onError("Could not select a destination folder.");
		} finally {
			if (mounted.current) setPicking(false);
		}
	};

	const submit = (): void => {
		if (canCreate && branch)
			void onCreate({
				kind: remote ? "remote" : existing ? "existing" : "new",
				branch: remote?.fullName ?? branch,
				path,
			});
	};

	return (
		<div style={styles.form}>
			<text style={styles.label}>New worktree</text>
			<div style={styles.field}>
				<text style={styles.hint}>Branch</text>
				<Combobox
					items={suggestions}
					filter={null}
					value={branch || null}
					inputValue={name}
					onInputValueChange={setName}
					disabled={disabled}
				>
					<div style={StyleSheet.compose(styles.input, styles.locationField)}>
						<ComboboxInput
							ref={branchInput}
							testId="worktree-branch-name"
							aria-label="Worktree branch name"
							placeholder="Choose or create a branch…"
							style={StyleSheet.compose(styles.input, styles.comboInput)}
						/>
						<ComboboxTrigger
							testId="worktree-branch-trigger"
							aria-label="Show branches"
							style={styles.comboTrigger}
						>
							<WorkspaceTabIcon name="caretDown" />
						</ComboboxTrigger>
					</div>
					<ComboboxContent role="listbox" sideOffset={4} style={styles.options}>
						{suggestions.map((value) => {
							const item = branches.find(
								(candidate) => candidate.value === value
							)?.item;

							const unavailable =
								!!item &&
								(item.checkedOut ||
									!!item.worktreePath ||
									(item.type === "remote" &&
										!!RepositoryBranches.remoteTarget(item, data.branches)
											.error));

							return (
								<ComboboxItem
									key={value}
									value={value}
									role="option"
									testId={`worktree-option-${value}`}
									disabled={unavailable}
									style={(state) =>
										StyleSheet.compose(
											styles.option,
											state.highlighted && { backgroundColor: colors.selected },
											unavailable && { opacity: 0.45 }
										)
									}
								>
									<text style={styles.fieldText}>
										{item ? value : `+ Create “${value}”`}
									</text>
									{unavailable ? (
										<text style={{ ...styles.hint, flexShrink: 0 }}>
											{item?.type === "remote"
												? "Local branch exists"
												: value === data.branches.current
													? "This workspace"
													: "Another worktree"}
										</text>
									) : null}
								</ComboboxItem>
							);
						})}
						{!suggestions.length ? (
							<text style={styles.hint}>No matching branches</text>
						) : null}
					</ComboboxContent>
				</Combobox>
				<text testId="worktree-branch-help" style={styles.hint}>
					{help}
				</text>
			</div>
			<div style={styles.field}>
				<text style={styles.hint}>Location</text>
				<Button
					tokens={appTokens}
					variant="ghost"
					size="sm"
					testId="worktree-change-location"
					aria-label="Change worktree location"
					disabled={disabled}
					style={StyleSheet.compose(styles.input, styles.locationField)}
					onPress={() => {
						void chooseLocation();
					}}
				>
					<svg
						testId="worktree-folder-icon"
						source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
						style={{
							width: iconSize.sm,
							height: iconSize.sm,
							flexShrink: 0,
							color: colors.textMuted,
							pointerEvents: "none",
						}}
					/>
					<text
						testId="worktree-location"
						aria-label={path}
						style={styles.fieldText}
					>
						{basename(path)}
					</text>
					<text
						style={{
							...typography.sm,
							color: colors.textMuted,
							pointerEvents: "none",
						}}
					>
						Change…
					</text>
				</Button>
			</div>
			<div style={styles.footer}>
				<Button
					tokens={appTokens}
					variant="secondary"
					size="sm"
					disabled={disabled}
					onPress={onCancel}
				>
					Cancel
				</Button>
				<Button
					tokens={appTokens}
					size="sm"
					testId="confirm-create-worktree"
					disabled={!canCreate}
					onPress={submit}
				>
					{busy ? "Creating…" : "Create and open"}
				</Button>
			</div>
		</div>
	);
}

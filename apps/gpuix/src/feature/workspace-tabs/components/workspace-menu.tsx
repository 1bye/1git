import { basename } from "node:path";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import {
	motion,
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useEffect, useRef, useState, type Dispatch } from "react";

import { appTokens } from "../../../styles/tokens";
import { workspaceLayout } from "../../../styles/workspace-layout";
import { WorkspaceTabPreview } from "./workspace-tab";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import { WorkspaceWorktreeForm } from "./workspace-worktree-form";
import type {
	WorktreeChoice,
	WorktreeRemoval,
} from "../lib/repository-worktrees";
import { WorkspaceMenuModel } from "../lib/workspace-menu-model";
import { RepositoryReader } from "../../repository-workspace/lib/repository-reader";
import { NativeFileMenu } from "../../repository-workspace/lib/native-file-menu";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
import type { SyncChoice } from "../../repository-workspace/lib/repository-sync";
import {
	RepositoryBranches,
	type BranchRequest,
	type WorkspaceBranches,
} from "../lib/repository-branches";
import type {
	WorkspaceTabRecord,
	WorkspaceTabsAction,
} from "../lib/workspace-tabs-model";

const { colors } = appTokens;
const maxMenuHeight = 370;
const menuWidth = 288;
const windowInset = 8;
const recentBranchCount = 3;
const rowHeight = 28;
const menuPadding = 4;
const headerHeight = 48;
const separatorHeight = 9;
const sectionLabelHeight = 24;
const noticeHeight = 56;
const createFormHeight = 150;
const worktreeFormHeight = 224;

const styles = StyleSheet.create({
	surface: {
		position: "absolute",
		width: menuWidth,
		backgroundColor: colors.overlay,
		borderRadius: 12,
		pointerEvents: "auto",
	},
	body: {
		width: menuWidth,
		display: "flex",
		flexDirection: "column",
		padding: menuPadding,
		overflow: "hidden",
	},
	header: {
		position: "relative",
		height: headerHeight,
		flexShrink: 0,
		display: "flex",
		flexDirection: "column",
		justifyContent: "center",
		paddingLeft: 8,
		paddingRight: 8,
		gap: 2,
	},
	separator: {
		height: 1,
		flexShrink: 0,
		marginTop: 4,
		marginBottom: 4,
		backgroundColor: colors.border,
	},
	heading: { fontSize: 12, fontWeight: 500 },
	muted: { fontSize: 11, color: colors.textMuted },
	detail: {
		fontSize: 10,
		color: colors.textMuted,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		minWidth: 0,
		maxWidth: "45%",
		flexShrink: 0,
	},
	sectionLabel: {
		height: sectionLabelHeight,
		flexShrink: 0,
		paddingLeft: 8,
		justifyContent: "center",
	},
	input: {
		width: "100%",
		height: 30,
		flexShrink: 0,
		fontSize: 12,
		paddingLeft: 9,
		paddingRight: 9,
		borderRadius: 6,
		backgroundColor: colors.field,
		color: colors.text,
		borderWidth: 1,
		borderColor: colors.border,
	},
	list: {
		minHeight: 0,
		flexGrow: 1,
		overflowY: "scroll",
		display: "flex",
		flexDirection: "column",
	},
	row: {
		width: "100%",
		height: rowHeight,
		flexDirection: "row",
		justifyContent: "flex-start",
		paddingLeft: 8,
		paddingRight: 8,
		gap: 8,
		borderRadius: 5,
	},
	label: {
		fontSize: 12,
		minWidth: 0,
		flexShrink: 1,
		flexGrow: 1,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
	},
	footer: {
		display: "flex",
		flexDirection: "row",
		justifyContent: "space-between",
		gap: 6,
		flexShrink: 0,
	},
	form: {
		display: "flex",
		flexDirection: "column",
		gap: 10,
		padding: 8,
		flexGrow: 1,
		minHeight: 0,
		overflowY: "scroll",
	},
	notice: {
		height: noticeHeight,
		flexShrink: 0,
		padding: 8,
		overflowY: "scroll",
	},
});

export interface WorkspaceMenuActions {
	onRemoveWorktree?: (
		id: string,
		choice: WorktreeRemoval
	) => Promise<string | null>;
	onCreateWorktree?: (
		id: string,
		choice: WorktreeChoice
	) => Promise<string | null>;
	readBranches: typeof RepositoryBranches.read;
	readRepository: typeof RepositoryReader.read;
	onChangeBranch: (
		id: string,
		choice: Omit<BranchRequest, "expectedHead" | "expectedBranch">
	) => Promise<string | null>;
	onFetch?: (id: string) => Promise<void>;
	onSync?: (id: string, choice: SyncChoice) => Promise<void>;
	onCancelSync?: (id: string) => void;
}

/** An attached workspace picker: branch writes stay with the window, not this transient surface. */
export function WorkspaceMenu({
	tab,
	anchor,
	dispatch,
	onClose,
	readBranches,
	readRepository,
	onChangeBranch,
	onCreateWorktree,
	onRemoveWorktree,
	onFetch,
	onSync,
	onCancelSync,
}: WorkspaceMenuActions & {
	tab: WorkspaceTabRecord;
	anchor: PublicInstance | undefined;
	dispatch: Dispatch<WorkspaceTabsAction>;
	onClose: () => void;
}) {
	const renderer = useGpuixRequired();
	const windowSize = useWindowSize();

	const anchorBounds = anchor
		? renderer.getElementBounds?.(anchor.id)
		: undefined;

	const [data, setData] = useState<WorkspaceBranches | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);
	const [remoteBranch, setRemoteBranch] = useState<string | null>(null);

	const [branchAction, setBranchAction] = useState<{
		kind: "rename" | "delete";
		name: string;
		oid: string;
	} | null>(null);

	const [creatingWorktree, setCreatingWorktree] = useState(false);

	const [removingWorktree, setRemovingWorktree] =
		useState<WorktreeRemoval | null>(null);

	const [publishing, setPublishing] = useState(false);
	const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [opening, setOpening] = useState(false);
	const mounted = useRef(true);
	const dialog = useRef<PublicInstance>(null);
	const list = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const request = useRef<AbortController | null>(null);
	const repository = tab.workspace.repository;
	const root = repository?.root;
	const head = repository?.head;
	const branch = repository?.branchName;
	const busy = opening || RepositoryWorkspaceModel.isBusy(tab.workspace);

	const {
		pending: syncKind,
		version: syncVersion,
		fetchedAt,
		error: syncError,
		notice: syncNotice,
	} = tab.workspace.sync;

	const fetching = syncKind === "fetch";

	const showFetch = !!onFetch && !!onCancelSync;
	const showSync = !!onSync && !!onCancelSync;

	const blocked =
		tab.workspace.entries.changes.length > 0 ||
		repository?.operation !== "normal" ||
		tab.workspace.commit.needsReview ||
		!!tab.workspace.error ||
		tab.workspace.loading;

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();
		};
	}, []);

	useEffect(() => {
		if (!root || syncKind) return;

		const controller = new AbortController();

		setData(null);
		setError(null);
		const load = async (): Promise<void> => {
			try {
				const result = await readBranches(root, controller.signal);

				if (controller.signal.aborted) return;

				if (result.ok) setData(result.value);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError(
						"Could not load branches. Close and reopen this menu to retry."
					);
			}
		};

		void load();

		return () => controller.abort();
	}, [root, head, branch, readBranches, syncKind, syncVersion]);

	const branches = [
		...WorkspaceMenuModel.recentBranches(data?.branches),
		...WorkspaceMenuModel.untrackedRemoteBranches(data?.branches),
	];

	const visibleBranches = expanded
		? branches
		: branches.slice(0, recentBranchCount);

	const hasMore = branches.length > recentBranchCount;

	const currentBranch = branches.find(
		(item) => item.type === "local" && item.name === branch
	);

	const canCreate = !busy && !blocked && data !== null;
	const canCompare = !busy && !!head && data !== null;

	const canCreateWorktree =
		!busy &&
		!!head &&
		repository?.operation === "normal" &&
		!tab.workspace.loading &&
		!tab.workspace.error &&
		!tab.workspace.commit.needsReview &&
		data !== null;

	const canFetch =
		showFetch && !busy && !tab.workspace.loading && !!data?.remotes.length;

	const hasUpstream =
		!!currentBranch?.upstreamRemote || !!currentBranch?.upstream;

	const targetRemote = data?.remotes.find(
		(remote) => remote.name === currentBranch?.upstreamRemote
	);

	const remoteRef = currentBranch?.upstreamRef;

	const diverged =
		!!currentBranch && currentBranch.ahead > 0 && currentBranch.behind > 0;

	const canSync =
		showSync &&
		!busy &&
		!!branch &&
		!!head &&
		!!currentBranch &&
		repository?.operation === "normal" &&
		!tab.workspace.loading &&
		!tab.workspace.error &&
		!tab.workspace.commit.needsReview;

	const canPull =
		canSync && !!targetRemote && !!remoteRef && !blocked && !diverged;

	const canPush =
		canSync &&
		!!targetRemote &&
		!!remoteRef &&
		targetRemote.pushUrls.length === 1;

	const canPublish =
		canSync &&
		!hasUpstream &&
		!!data?.remotes.some((remote) => remote.pushUrls.length === 1);

	let fetchStatus = "";

	if (fetching) fetchStatus = "Cancel";
	else if (data && !data.remotes.length) fetchStatus = "No remote";
	else if (fetchedAt)
		fetchStatus = `Fetched ${WorkspaceMenuModel.commitAge(new Date(fetchedAt).toISOString())}`;

	const worktrees =
		data?.worktrees.filter((item) => item.path !== root && !item.prunable) ??
		[];

	const enabledIds = visibleBranches
		.filter(
			(item) =>
				!busy &&
				((item.type === "local" && item.name === branch) ||
					(!blocked &&
						!item.worktreePath &&
						!(
							item.type === "remote" &&
							data &&
							RepositoryBranches.remoteTarget(item, data.branches).error
						)))
		)
		.map(
			(item) => `branch-${item.type === "remote" ? item.fullName : item.name}`
		);

	if (!busy && hasMore) enabledIds.push("more-branches");

	if (!busy)
		for (const worktree of worktrees)
			enabledIds.push(`worktree-${worktree.path}`);

	if (canCompare) enabledIds.push("compare-branches");

	if (canCreate) enabledIds.push("create-branch");

	if (onCreateWorktree && canCreateWorktree) enabledIds.push("create-worktree");

	if (showFetch && (fetching || canFetch)) enabledIds.push("fetch-repository");

	if (showSync && (syncKind === "pull" || canPull))
		enabledIds.push("pull-repository");

	if (
		showSync &&
		(syncKind === "push" ||
			syncKind === "publish" ||
			(hasUpstream ? canPush : canPublish))
	)
		enabledIds.push("push-repository");

	if (publishing) {
		enabledIds.length = 0;

		if (!busy) {
			for (const remote of data?.remotes ?? []) {
				if (remote.pushUrls.length === 1)
					enabledIds.push(`publish-remote-${remote.name}`);
			}

			enabledIds.push("cancel-publish");

			if (selectedRemote && canPublish) enabledIds.push("confirm-publish");
		}
	}

	const notice =
		error ??
		syncError ??
		tab.workspace.error ??
		syncNotice ??
		(busy && !syncKind ? "Updating workspace…" : null);

	// Fixed header/action rows surround a scrollable list; the expanded menu stays inside the window.
	const contentHeight = removingWorktree
		? 230
		: creatingWorktree
			? worktreeFormHeight
			: creating
				? createFormHeight
				: publishing
					? menuPadding * 2 +
						headerHeight +
						separatorHeight * 2 +
						rowHeight * ((data?.remotes.length ?? 0) + 1)
					: menuPadding * 2 +
						headerHeight +
						separatorHeight * 2 +
						rowHeight +
						(onCreateWorktree ? rowHeight : 0) +
						(showFetch ? separatorHeight + rowHeight : 0) +
						(showSync ? rowHeight * 2 : 0) +
						Math.max(1, visibleBranches.length + worktrees.length) * rowHeight +
						(hasMore ? rowHeight : 0) +
						(worktrees.length ? sectionLabelHeight : 0);

	const menuHeight = Math.min(
		maxMenuHeight,
		windowSize.height -
			(anchorBounds?.y ?? 0) -
			workspaceLayout.tabHeight -
			windowInset,
		contentHeight + (notice ? noticeHeight : 0)
	);

	const showActions = (): void => {
		setCreating(false);
		setRemoteBranch(null);
		setBranchAction(null);
		setCreatingWorktree(false);
		setRemovingWorktree(null);
		setPublishing(false);
		setError(null);

		if (dialog.current) renderer.focusElement?.(dialog.current.id);
	};

	const openComparison = (): void => {
		if (!canCompare || !head || !repository || !data) return;

		dispatch({
			type: "compare",
			id: tab.id,
			comparison: {
				root: repository.root,
				base: head,
				baseName: branch ?? "HEAD",
				branches: data.branches.branches.map((item) => ({
					value: item.fullName,
					label: item.name,
					oid: item.oid,
				})),
			},
		});
		onClose();
	};

	const onKeyDown = (event: EventPayload): void => {
		if ((creatingWorktree || removingWorktree) && event.key !== "escape")
			return;

		if (event.key === "escape" || event.key === "tab") {
			if (
				event.key === "escape" &&
				(creating || publishing || creatingWorktree || removingWorktree) &&
				!busy
			)
				showActions();
			else onClose();

			return;
		}

		if (creating || (event.key !== "down" && event.key !== "up")) return;

		const focused = renderer.getFocusedElementId?.();

		const focusedIndex = enabledIds.findIndex(
			(id) => rows.current.get(id)?.id === focused
		);

		const index = focusedIndex < 0 && event.key === "up" ? 0 : focusedIndex;

		const next =
			enabledIds[
				(index + (event.key === "down" ? 1 : -1) + enabledIds.length) %
					enabledIds.length
			];

		const node = next ? rows.current.get(next) : undefined;

		if (node) {
			renderer.focusElement?.(node.id);

			if (
				!list.current ||
				next === "create-branch" ||
				next === "create-worktree" ||
				next === "fetch-repository" ||
				next === "pull-repository" ||
				next === "push-repository" ||
				next === "cancel-publish" ||
				next === "confirm-publish"
			)
				return;

			const viewport = renderer.getElementBounds?.(list.current.id);
			const target = renderer.getElementBounds?.(node.id);

			if (!viewport || !target) return;

			const offset = renderer.getScrollOffset?.(list.current.id)?.[1] ?? 0;
			// As in RepositoryList, GPUIX bounds include the scroll offset; recover the clip origin.
			const top = viewport.y - offset;

			const delta =
				target.y < top
					? target.y - top
					: Math.max(0, target.y + target.height - top - viewport.height);

			renderer.scrollTo?.(list.current.id, 0, offset - delta);
		}
	};

	const change = async (name: string): Promise<void> => {
		if (busy || blocked || !name.trim()) return;

		setError(null);
		const message = await onChangeBranch(
			tab.id,
			branchAction
				? {
						kind: branchAction.kind,
						name: branchAction.name,
						newName: branchAction.kind === "rename" ? name.trim() : undefined,
						expectedTarget: branchAction.oid,
					}
				: {
						kind: remoteBranch ? "remote" : creating ? "create" : "switch",
						name: remoteBranch ?? name.trim(),
					}
		);

		if (!mounted.current) return;

		if (message) setError(message);
		else onClose();
	};

	const synchronize = (kind: "pull" | "push"): void => {
		if (syncKind === kind) {
			onCancelSync?.(tab.id);

			return;
		}

		if (!targetRemote || !remoteRef || !(kind === "pull" ? canPull : canPush))
			return;

		setError(null);
		void onSync?.(tab.id, { kind, remote: targetRemote.name, remoteRef });
	};

	const openWorktree = async (path: string): Promise<void> => {
		if (busy) return;

		setOpening(true);
		setError(null);
		const controller = new AbortController();

		request.current = controller;

		try {
			const result = await readRepository(path, controller.signal);

			if (controller.signal.aborted) return;

			if (result.ok) {
				dispatch({ type: "open-worktree", snapshot: result.value });
				onClose();
			} else setError(result.error.message);
		} catch {
			if (!controller.signal.aborted) setError("Could not open this worktree.");
		} finally {
			if (!controller.signal.aborted) setOpening(false);
		}
	};

	if (!anchorBounds) return null;

	const menuLeft = Math.max(
		windowInset,
		Math.min(
			anchorBounds.x + workspaceLayout.tabWidth / 2 - menuWidth / 2,
			windowSize.width - menuWidth - windowInset
		)
	);

	// Match floating controls' priority so nested selects paint after this surface, not behind it.
	return (
		<anchored
			position={{ x: 0, y: 0 }}
			anchor="topLeft"
			snapMargin={0}
			deferred
			priority={1}
			occlude
			style={{
				width: windowSize.width,
				height: windowSize.height,
				backgroundColor: "rgba(0, 0, 0, 0.32)",
				pointerEvents: "auto",
			}}
		>
			<div
				testId="workspace-menu-backdrop"
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
				}}
				onClick={onClose}
			/>
			<div
				ref={dialog}
				testId="workspace-menu"
				role="dialog"
				aria-label="Workspace branches"
				tabIndex={-1}
				autoFocus
				onKeyDown={onKeyDown}
				style={StyleSheet.compose(styles.surface, {
					left: menuLeft,
					top: anchorBounds.y + workspaceLayout.tabHeight - 1,
				})}
			>
				<motion.div
					style={StyleSheet.compose(styles.body, { height: menuHeight })}
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: menuHeight, opacity: 1 }}
					transition={{ duration: 0.16, ease: "easeOut" }}
				>
					{removingWorktree && onRemoveWorktree ? (
						<div style={{ ...styles.form, minHeight: 0, overflowY: "scroll" }}>
							<Text tokens={appTokens} style={styles.heading}>
								Remove worktree?
							</Text>
							<Text tokens={appTokens} style={{ fontSize: 11 }}>
								{removingWorktree.path}
							</Text>
							<Text tokens={appTokens} style={styles.muted}>
								This deletes the folder, but keeps its branch.
							</Text>
							<Text tokens={appTokens} style={styles.muted}>
								Its tabs will close. Any saved commit drafts in those tabs will
								be discarded.
							</Text>
							<div style={styles.footer}>
								<Button
									tokens={appTokens}
									variant="secondary"
									size="sm"
									testId="cancel-remove-worktree"
									disabled={busy}
									onPress={showActions}
								>
									Cancel
								</Button>
								<Button
									tokens={appTokens}
									size="sm"
									testId="confirm-remove-worktree"
									disabled={busy}
									onPress={() => {
										void (async () => {
											setError(null);
											const message = await onRemoveWorktree(
												tab.id,
												removingWorktree
											);

											if (!mounted.current) return;

											if (message) setError(message);
											else onClose();
										})();
									}}
								>
									{busy ? "Removing…" : "Remove worktree"}
								</Button>
							</div>
						</div>
					) : creatingWorktree && root && data && onCreateWorktree ? (
						<WorkspaceWorktreeForm
							root={root}
							data={data}
							busy={busy}
							onCancel={showActions}
							onError={setError}
							onCreate={async (choice) => {
								if (!canCreateWorktree) return;

								setError(null);
								const message = await onCreateWorktree(tab.id, choice);

								if (!mounted.current) return;

								if (message) setError(message);
								else onClose();
							}}
						/>
					) : creating ? (
						<div style={styles.form}>
							<Text tokens={appTokens} style={styles.heading}>
								{branchAction
									? branchAction.kind === "rename"
										? "Rename branch"
										: "Delete branch?"
									: remoteBranch
										? "Check out remote branch"
										: "Create new branch"}
							</Text>
							<input
								testId="branch-name"
								autoFocus
								aria-label="New branch name"
								placeholder="New branch name…"
								value={name}
								readOnly={
									busy || !!remoteBranch || branchAction?.kind === "delete"
								}
								style={styles.input}
								onChange={(event) => setName(event.value ?? "")}
								onSubmit={() => {
									void change(name);
								}}
							/>
							<Text tokens={appTokens} style={styles.muted}>
								{branchAction
									? branchAction.kind === "rename"
										? `Rename “${branchAction.name}” locally. Remote branches stay unchanged.`
										: "Deletes only the local branch. Unmerged work is protected."
									: remoteBranch
										? `Tracks ${remoteBranch.replace("refs/remotes/", "")} in this workspace.`
										: `Create from ${repository?.branch ?? "HEAD"} and switch this workspace to it.`}
							</Text>
							<div style={styles.footer}>
								<Button
									testId="cancel-create-branch"
									tokens={appTokens}
									variant="ghost"
									size="sm"
									disabled={busy}
									onPress={showActions}
								>
									Cancel
								</Button>
								<Button
									testId="create-branch"
									tokens={appTokens}
									size="sm"
									disabled={!canCreate || !name.trim()}
									onPress={() => {
										void change(name);
									}}
								>
									{branchAction
										? branchAction.kind === "rename"
											? "Rename branch"
											: "Delete branch"
										: "Create and switch"}
								</Button>
							</div>
						</div>
					) : publishing ? (
						<>
							<div style={styles.header}>
								<Text tokens={appTokens} style={styles.heading}>
									Publish branch
								</Text>
								<Text
									tokens={appTokens}
									style={styles.muted}
								>{`Choose a remote for ${branch ?? "this branch"}`}</Text>
							</div>
							<div style={styles.separator} />
							<div ref={list} style={styles.list} testId="publish-remotes">
								{data?.remotes.map((remote) => (
									<Button
										key={remote.name}
										testId={`publish-remote-${remote.name}`}
										ref={(node) => {
											const id = `publish-remote-${remote.name}`;

											if (node) rows.current.set(id, node);
											else rows.current.delete(id);
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={busy || remote.pushUrls.length !== 1}
										aria-label={`${remote.name}${selectedRemote === remote.name ? ", selected" : ""}`}
										onPress={() => setSelectedRemote(remote.name)}
									>
										<WorkspaceTabIcon
											name={selectedRemote === remote.name ? "check" : "branch"}
										/>
										<Text tokens={appTokens} style={styles.label}>
											{remote.name}
										</Text>
									</Button>
								))}
							</div>
							<div style={styles.separator} />
							<div style={styles.footer}>
								<Button
									testId="cancel-publish"
									ref={(node) => {
										if (node) rows.current.set("cancel-publish", node);
										else rows.current.delete("cancel-publish");
									}}
									tokens={appTokens}
									variant="ghost"
									size="sm"
									disabled={busy}
									onPress={showActions}
								>
									Cancel
								</Button>
								<Button
									testId="confirm-publish"
									ref={(node) => {
										if (node) rows.current.set("confirm-publish", node);
										else rows.current.delete("confirm-publish");
									}}
									tokens={appTokens}
									size="sm"
									disabled={!canPublish || !selectedRemote}
									onPress={() => {
										if (!branch || !selectedRemote || !canPublish) return;

										setError(null);
										setPublishing(false);
										void onSync?.(tab.id, {
											kind: "publish",
											remote: selectedRemote,
											remoteRef: `refs/heads/${branch}`,
										});
									}}
								>
									{selectedRemote ? `Publish to ${selectedRemote}` : "Publish"}
								</Button>
							</div>
						</>
					) : (
						<>
							<div
								style={StyleSheet.compose(styles.header, { paddingRight: 80 })}
							>
								<Button
									testId="compare-branches"
									aria-label="Compare branches"
									ref={(node) => {
										if (node) rows.current.set("compare-branches", node);
										else rows.current.delete("compare-branches");
									}}
									tokens={appTokens}
									variant="secondary"
									size="sm"
									style={{ position: "absolute", right: 4, top: 8 }}
									disabled={!canCompare}
									onPress={openComparison}
								>
									Compare
								</Button>
								<Text
									tokens={appTokens}
									style={StyleSheet.compose(styles.label, styles.heading, {
										flexGrow: 0,
									})}
								>
									{branch ?? "Detached HEAD"}
								</Text>
								<Text
									testId="branch-tracking"
									tokens={appTokens}
									style={StyleSheet.compose(styles.label, styles.muted, {
										flexGrow: 0,
									})}
								>
									{data ? WorkspaceMenuModel.trackingLabel(currentBranch) : ""}
								</Text>
							</div>
							<div style={styles.separator} />
							<div ref={list} testId="workspace-menu-list" style={styles.list}>
								{!data && !error ? (
									<Text tokens={appTokens} style={styles.muted}>
										Loading branches…
									</Text>
								) : null}
								{visibleBranches.map((item) => {
									const id = `branch-${item.type === "remote" ? item.fullName : item.name}`;
									const current = item.type === "local" && item.name === branch;

									const target =
										item.type === "remote" && data
											? RepositoryBranches.remoteTarget(item, data.branches)
											: null;

									return (
										<Button
											key={id}
											testId={id}
											ref={(node) => {
												if (node) rows.current.set(id, node);
												else rows.current.delete(id);
											}}
											tokens={appTokens}
											variant="ghost"
											size="sm"
											style={styles.row}
											disabled={
												busy ||
												!!target?.error ||
												(!current && (blocked || !!item.worktreePath))
											}
											aria-label={`${item.name}${current ? ", current branch" : ""}`}
											aria-description={
												target?.error ??
												(!current && item.worktreePath
													? "Checked out in another worktree"
													: item.summary)
											}
											onContextMenu={
												item.type === "local"
													? (event) => {
															try {
																const enabled = [
																	canCreate && (current || !item.worktreePath),
																	canCreate &&
																		!item.checkedOut &&
																		!item.worktreePath,
																];

																const bounds = renderer.getElementBounds?.(
																	event.elementId
																);

																const choice = NativeFileMenu.show(
																	renderer,
																	["Rename branch…", "Delete branch…"],
																	enabled,
																	event.x ?? bounds?.x ?? 0,
																	event.y ?? bounds?.y ?? 0
																);

																if (choice < 0 || !enabled[choice]) return;

																setBranchAction({
																	kind: choice === 0 ? "rename" : "delete",
																	name: item.name,
																	oid: item.oid,
																});
																setName(item.name);
																setRemoteBranch(null);
																setError(null);
																setCreating(true);
															} catch (cause) {
																setError(
																	cause instanceof Error
																		? cause.message
																		: "Could not open the branch menu."
																);
															}
														}
													: undefined
											}
											onPress={() => {
												if (target) {
													setRemoteBranch(item.fullName);
													setName(target.name);
													setCreating(true);
												} else if (current) onClose();
												else void change(item.name);
											}}
										>
											<WorkspaceTabIcon
												name={current ? "check" : "branch"}
												color={current ? colors.accent : colors.textMuted}
											/>
											<Text tokens={appTokens} style={styles.label}>
												{item.name}
											</Text>
											<Text tokens={appTokens} style={styles.detail}>
												{target
													? target.error
														? "Local branch exists"
														: "Remote"
													: !current && item.worktreePath
														? "Other worktree"
														: WorkspaceMenuModel.commitAge(item.committedAt)}
											</Text>
										</Button>
									);
								})}
								{data && !branches.length ? (
									<div style={styles.sectionLabel}>
										<Text tokens={appTokens} style={styles.muted}>
											No local branches available.
										</Text>
									</div>
								) : null}
								{hasMore ? (
									<Button
										testId="more-branches"
										ref={(node) => {
											if (node) rows.current.set("more-branches", node);
											else rows.current.delete("more-branches");
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={busy}
										aria-label={
											expanded ? "Show fewer branches" : "Show all branches"
										}
										onPress={() => setExpanded((value) => !value)}
									>
										<Text tokens={appTokens} style={styles.label}>
											More
										</Text>
										<WorkspaceTabIcon
											name={expanded ? "caretDown" : "caretRight"}
										/>
									</Button>
								) : null}
								{worktrees.length ? (
									<div style={styles.sectionLabel}>
										<Text tokens={appTokens} style={styles.muted}>
											Worktrees
										</Text>
									</div>
								) : null}
								{worktrees.map((item) => {
									const id = `worktree-${item.path}`;

									return (
										<Button
											key={id}
											testId={id}
											ref={(node) => {
												if (node) rows.current.set(id, node);
												else rows.current.delete(id);
											}}
											tokens={appTokens}
											variant="ghost"
											size="sm"
											style={styles.row}
											disabled={busy}
											aria-label={`Open ${item.branch?.replace(/^refs\/heads\//, "") ?? "detached HEAD"} worktree`}
											aria-description={item.path}
											onContextMenu={
												onRemoveWorktree
													? (event) => {
															try {
																const enabled =
																	canCreateWorktree &&
																	!item.locked &&
																	!item.prunable &&
																	item.path !== data?.worktrees[0]?.path;

																const bounds = renderer.getElementBounds?.(
																	event.elementId
																);

																const choice = NativeFileMenu.show(
																	renderer,
																	["Remove worktree…"],
																	[enabled],
																	event.x ?? bounds?.x ?? 0,
																	event.y ?? bounds?.y ?? 0
																);

																if (choice !== 0 || !enabled) return;

																setError(null);
																setRemovingWorktree({
																	kind: "remove",
																	path: item.path,
																	expectedHead: item.headOid,
																	expectedBranch: item.branch,
																});
															} catch (cause) {
																setError(
																	cause instanceof Error
																		? cause.message
																		: "Could not open the worktree menu."
																);
															}
														}
													: undefined
											}
											onPress={() => {
												void openWorktree(item.path);
											}}
										>
											<WorkspaceTabIcon name="branch" />
											<Text tokens={appTokens} style={styles.label}>
												{item.branch?.replace(/^refs\/heads\//, "") ??
													"Detached HEAD"}
											</Text>
											<Text tokens={appTokens} style={styles.detail}>
												{basename(item.path)}
											</Text>
										</Button>
									);
								})}
							</div>
							<div style={styles.separator} />
							<Button
								testId="create-branch"
								ref={(node) => {
									if (node) rows.current.set("create-branch", node);
									else rows.current.delete("create-branch");
								}}
								tokens={appTokens}
								variant="ghost"
								size="sm"
								style={styles.row}
								disabled={!canCreate}
								aria-label="Create new branch"
								onPress={() => {
									setCreating(true);
									setName("");
									setError(null);
								}}
							>
								<WorkspaceTabIcon name="add" />
								<Text tokens={appTokens} style={styles.label}>
									Create new branch…
								</Text>
							</Button>
							{onCreateWorktree ? (
								<Button
									testId="create-worktree"
									ref={(node) => {
										if (node) rows.current.set("create-worktree", node);
										else rows.current.delete("create-worktree");
									}}
									tokens={appTokens}
									variant="ghost"
									size="sm"
									style={styles.row}
									disabled={!canCreateWorktree}
									onPress={() => {
										setCreatingWorktree(true);
										setError(null);
									}}
								>
									<WorkspaceTabIcon name="add" />
									<Text tokens={appTokens} style={styles.label}>
										New worktree…
									</Text>
								</Button>
							) : null}
							{showFetch ? (
								<>
									<div style={styles.separator} />
									<Button
										testId="fetch-repository"
										ref={(node) => {
											if (node) rows.current.set("fetch-repository", node);
											else rows.current.delete("fetch-repository");
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={!fetching && !canFetch}
										aria-label={fetching ? "Cancel fetch" : "Fetch all remotes"}
										aria-description={
											data && !data.remotes.length
												? "No remote configured"
												: "Refresh remote refs without changing your files or local branch"
										}
										onPress={() => {
											if (fetching) onCancelSync?.(tab.id);
											else {
												setError(null);
												void onFetch?.(tab.id);
											}
										}}
									>
										<WorkspaceTabIcon name={fetching ? "close" : "sync"} />
										<Text tokens={appTokens} style={styles.label}>
											{fetching ? "Fetching…" : "Fetch"}
										</Text>
										<Text
											testId="fetch-status"
											tokens={appTokens}
											style={styles.detail}
										>
											{fetchStatus}
										</Text>
									</Button>
								</>
							) : null}
							{showSync ? (
								<>
									<Button
										testId="pull-repository"
										ref={(node) => {
											if (node) rows.current.set("pull-repository", node);
											else rows.current.delete("pull-repository");
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={syncKind !== "pull" && !canPull}
										aria-label={
											syncKind === "pull"
												? "Stop pull"
												: "Pull upstream, fast-forward only"
										}
										aria-description={
											blocked
												? "Requires a clean working tree and no ongoing Git operation"
												: "Updates this branch without merging, rebasing or stashing"
										}
										onPress={() => synchronize("pull")}
									>
										<WorkspaceTabIcon name="pull" />
										<Text tokens={appTokens} style={styles.label}>
											{syncKind === "pull" ? "Pulling…" : "Pull"}
										</Text>
										<Text tokens={appTokens} style={styles.detail}>
											{syncKind === "pull"
												? "Stop"
												: diverged
													? "Diverged"
													: !hasUpstream
														? "No upstream"
														: currentBranch?.behind
															? `${currentBranch.behind} behind`
															: ""}
										</Text>
									</Button>
									<Button
										testId="push-repository"
										ref={(node) => {
											if (node) rows.current.set("push-repository", node);
											else rows.current.delete("push-repository");
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={
											syncKind !== "push" &&
											syncKind !== "publish" &&
											!(hasUpstream ? canPush : canPublish)
										}
										aria-label={
											syncKind === "push" || syncKind === "publish"
												? "Stop push"
												: hasUpstream
													? "Push current branch to upstream"
													: "Publish branch"
										}
										onPress={() => {
											if (syncKind === "publish") onCancelSync?.(tab.id);
											else if (hasUpstream || syncKind === "push")
												synchronize("push");
											else {
												setPublishing(true);
												setSelectedRemote(null);
												setError(null);

												if (dialog.current)
													renderer.focusElement?.(dialog.current.id);
											}
										}}
									>
										<WorkspaceTabIcon name="push" />
										<Text tokens={appTokens} style={styles.label}>
											{syncKind === "push"
												? "Pushing…"
												: syncKind === "publish"
													? "Publishing…"
													: hasUpstream
														? "Push"
														: "Publish branch…"}
										</Text>
										<Text tokens={appTokens} style={styles.detail}>
											{syncKind === "push" || syncKind === "publish"
												? "Stop"
												: !data?.remotes.length
													? "No remote"
													: currentBranch?.ahead
														? `${currentBranch.ahead} ahead`
														: ""}
										</Text>
									</Button>
								</>
							) : null}
						</>
					)}
					{notice ? (
						<div style={styles.notice}>
							<Text
								testId="branch-notice"
								tokens={appTokens}
								style={styles.muted}
							>
								{notice}
							</Text>
						</div>
					) : null}
				</motion.div>
			</div>
			<div
				style={{
					position: "absolute",
					left: anchorBounds.x,
					top: anchorBounds.y,
					width: workspaceLayout.tabWidth,
					height: workspaceLayout.tabHeight,
				}}
			>
				<WorkspaceTabPreview tab={tab} onClose={onClose} />
			</div>
		</anchored>
	);
}

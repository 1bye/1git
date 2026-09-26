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
import { WorkspaceMenuModel } from "../lib/workspace-menu-model";
import { RepositoryReader } from "../../repository-workspace/lib/repository-reader";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
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
	readBranches: typeof RepositoryBranches.read;
	readRepository: typeof RepositoryReader.read;
	onChangeBranch: (
		id: string,
		choice: Pick<BranchRequest, "kind" | "name">
	) => Promise<string | null>;
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
		if (!root) return;

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
	}, [root, head, branch, readBranches]);

	const branches = WorkspaceMenuModel.recentBranches(data?.branches);

	const visibleBranches = expanded
		? branches
		: branches.slice(0, recentBranchCount);

	const hasMore = branches.length > recentBranchCount;
	const currentBranch = branches.find((item) => item.name === branch);
	const canCreate = !busy && !blocked && data !== null;

	const worktrees =
		data?.worktrees.filter((item) => item.path !== root && !item.prunable) ??
		[];

	const enabledIds = visibleBranches
		.filter(
			(item) =>
				!busy && (item.name === branch || (!blocked && !item.worktreePath))
		)
		.map((item) => `branch-${item.name}`);

	if (!busy && hasMore) enabledIds.push("more-branches");

	if (!busy)
		for (const worktree of worktrees)
			enabledIds.push(`worktree-${worktree.path}`);

	if (canCreate) enabledIds.push("create-branch");

	const notice =
		error ??
		(busy
			? "Updating workspace…"
			: blocked
				? "Commit or stash changes and resolve any Git operation before switching. Refresh if needed."
				: null);

	// Fixed header/action rows surround a scrollable list; the expanded menu stays inside the window.
	const contentHeight = creating
		? createFormHeight
		: menuPadding * 2 +
			headerHeight +
			separatorHeight * 2 +
			rowHeight +
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
		setError(null);

		if (dialog.current) renderer.focusElement?.(dialog.current.id);
	};

	const onKeyDown = (event: EventPayload): void => {
		if (event.key === "escape" || event.key === "tab") {
			if (event.key === "escape" && creating && !busy) showActions();
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

			if (!list.current || next === "create-branch") return;

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
		const message = await onChangeBranch(tab.id, {
			kind: creating ? "create" : "switch",
			name: name.trim(),
		});

		if (!mounted.current) return;

		if (message) setError(message);
		else onClose();
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

	// One deferred layer keeps the backdrop above native lists and the copied tab/menu above the dimming.
	return (
		<anchored
			position={{ x: 0, y: 0 }}
			anchor="topLeft"
			snapMargin={0}
			deferred
			priority={2}
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
					{creating ? (
						<div style={styles.form}>
							<Text tokens={appTokens} style={styles.heading}>
								Create new branch
							</Text>
							<input
								testId="branch-name"
								autoFocus
								aria-label="New branch name"
								placeholder="New branch name…"
								value={name}
								readOnly={busy}
								style={styles.input}
								onChange={(event) => setName(event.value ?? "")}
								onSubmit={() => {
									void change(name);
								}}
							/>
							<Text tokens={appTokens} style={styles.muted}>
								{`Create from ${repository?.branch ?? "HEAD"} and switch this workspace to it.`}
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
									Create and switch
								</Button>
							</div>
						</div>
					) : (
						<>
							<div style={styles.header}>
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
									const id = `branch-${item.name}`;
									const current = item.name === branch;

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
												busy || (!current && (blocked || !!item.worktreePath))
											}
											aria-label={`${item.name}${current ? ", current branch" : ""}`}
											aria-description={
												!current && item.worktreePath
													? "Checked out in another worktree"
													: item.summary
											}
											onPress={() => {
												if (current) onClose();
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
												{!current && item.worktreePath
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

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
const menuWidth = 320;
const windowInset = 8;

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
		padding: 10,
		gap: 8,
		overflow: "hidden",
	},
	heading: { fontSize: 12, fontWeight: 500 },
	muted: { fontSize: 11, color: colors.textMuted },
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
		gap: 2,
	},
	row: {
		width: "100%",
		height: 30,
		flexDirection: "row",
		justifyContent: "space-between",
		paddingLeft: 8,
		paddingRight: 8,
	},
	label: {
		fontSize: 12,
		minWidth: 0,
		flexShrink: 1,
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
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const [opening, setOpening] = useState(false);
	const mounted = useRef(true);
	const input = useRef<PublicInstance>(null);
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

	const needle = query.trim().toLowerCase();

	const branches =
		data?.branches.branches.filter(
			(item) =>
				item.type === "local" && item.name.toLowerCase().includes(needle)
		) ?? [];

	const worktrees =
		data?.worktrees.filter(
			(item) =>
				item.path !== root &&
				!item.prunable &&
				`${item.branch ?? ""} ${item.path}`.toLowerCase().includes(needle)
		) ?? [];

	const enabledIds = branches
		.filter(
			(item) =>
				!busy && (item.name === branch || (!blocked && !item.worktreePath))
		)
		.map((item) => `branch-${item.name}`);

	if (!busy)
		for (const worktree of worktrees)
			enabledIds.push(`worktree-${worktree.path}`);

	const notice =
		error ??
		(busy
			? "Updating workspace…"
			: blocked
				? "Commit or stash changes and resolve any Git operation before switching. Refresh if needed."
				: null);

	const menuHeight = creating
		? 210
		: Math.min(
				maxMenuHeight,
				112 +
					Math.max(1, branches.length + worktrees.length) * 32 +
					(worktrees.length ? 22 : 0) +
					(notice ? 55 : 0)
			);

	const onKeyDown = (event: EventPayload, id?: string): void => {
		if (event.key === "escape" || event.key === "tab") {
			onClose();

			return;
		}

		if (event.key !== "down" && event.key !== "up") return;

		const index = id ? enabledIds.indexOf(id) : event.key === "down" ? -1 : 0;

		const next =
			enabledIds[
				(index + (event.key === "down" ? 1 : -1) + enabledIds.length) %
					enabledIds.length
			];

		const node = next ? rows.current.get(next) : undefined;

		if (node) {
			renderer.focusElement?.(node.id);
			renderer.scrollIntoView?.(node.id);
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
				testId="workspace-menu"
				role="dialog"
				aria-label="Workspace branches"
				style={StyleSheet.compose(styles.surface, {
					left: menuLeft,
					top: anchorBounds.y + workspaceLayout.tabHeight - 1,
				})}
			>
				<motion.div
					style={styles.body}
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: menuHeight, opacity: 1 }}
					transition={{ duration: 0.16, ease: "easeOut" }}
				>
					<Text tokens={appTokens} style={styles.heading}>
						{creating ? "Create branch" : "Switch branch"}
					</Text>
					<input
						ref={input}
						testId="branch-search"
						autoFocus
						aria-label={
							creating ? "New branch name" : "Search branches and worktrees"
						}
						placeholder={
							creating ? "New branch name…" : "Search branches and worktrees…"
						}
						value={query}
						readOnly={busy}
						style={styles.input}
						onChange={(event) => setQuery(event.value ?? "")}
						onKeyDown={(event) => onKeyDown(event)}
						onSubmit={() => {
							if (creating) void change(query);
						}}
					/>
					<div style={styles.list}>
						{creating ? (
							<Text
								tokens={appTokens}
								style={styles.muted}
							>{`Create from ${repository?.branch ?? "HEAD"} and switch this workspace to it.`}</Text>
						) : (
							<>
								{!data && !error ? (
									<Text tokens={appTokens} style={styles.muted}>
										Loading branches…
									</Text>
								) : null}
								{branches.map((item) => {
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
											onKeyDown={(event) => onKeyDown(event, id)}
											onPress={() => {
												if (current) onClose();
												else void change(item.name);
											}}
										>
											<Text tokens={appTokens} style={styles.label}>
												{item.name}
											</Text>
											<Text tokens={appTokens} style={styles.muted}>
												{current
													? "Current"
													: item.worktreePath
														? "Other worktree"
														: ""}
											</Text>
										</Button>
									);
								})}
								{worktrees.length ? (
									<Text tokens={appTokens} style={styles.muted}>
										Open worktree in a tab
									</Text>
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
											aria-description={item.path}
											onKeyDown={(event) => onKeyDown(event, id)}
											onPress={() => {
												void openWorktree(item.path);
											}}
										>
											<Text tokens={appTokens} style={styles.label}>
												{item.branch?.replace(/^refs\/heads\//, "") ??
													"Detached HEAD"}
											</Text>
											<Text tokens={appTokens} style={styles.muted}>
												{basename(item.path)}
											</Text>
										</Button>
									);
								})}
								{data && !branches.length && !worktrees.length ? (
									<Text tokens={appTokens} style={styles.muted}>
										No matching branches or worktrees.
									</Text>
								) : null}
							</>
						)}
					</div>
					{notice ? (
						<Text
							testId="branch-notice"
							tokens={appTokens}
							style={styles.muted}
						>
							{notice}
						</Text>
					) : null}
					<div style={styles.footer}>
						<Button
							tokens={appTokens}
							variant="ghost"
							size="sm"
							onKeyDown={(event) => onKeyDown(event)}
							onPress={onClose}
						>
							Close
						</Button>
						<Button
							testId="create-branch"
							tokens={appTokens}
							variant="secondary"
							size="sm"
							disabled={busy || blocked || (creating && !query.trim())}
							onKeyDown={(event) => onKeyDown(event)}
							onPress={() => {
								if (creating) void change(query);
								else {
									setCreating(true);
									setQuery("");

									if (input.current) renderer.focusElement?.(input.current.id);
								}
							}}
						>
							{creating ? "Create and switch" : "New branch…"}
						</Button>
					</div>
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

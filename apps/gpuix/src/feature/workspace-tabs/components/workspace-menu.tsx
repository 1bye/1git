import { MachineLocation } from "../../machines/machine-location";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { radius, spacing, typography, fontWeight } from "@1git/design-tokens";
import { basename } from "node:path";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { setRefs, FloatingLayer } from "@gpuix/react/floating";
import {
	motion,
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type Ref,
	type ReactNode,
	type RefObject,
} from "react";

import { workspaceLayout } from "../../../styles/workspace-layout";
import { WorkspaceTabPreview } from "./workspace-tab";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import { WorkspaceWorktreeForm } from "./workspace-worktree-form";
import { WorkspaceMergeForm } from "./workspace-merge-form";
import { WorkspaceBranchChangesForm } from "./workspace-branch-changes-form";
import type {
	WorktreeChoice,
	WorktreeRemoval,
} from "../lib/repository-worktrees";
import { WorkspaceMenuModel } from "../lib/workspace-menu-model";
import { RepositoryReader } from "../../repository-workspace/lib/repository-reader";
import { NativeFileMenu } from "../../repository-workspace/lib/native-file-menu";
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

const maxMenuHeight = 398;
const maxWorktreeMenuHeight = 370;
const maxExpandedMenuHeight = 650;
const menuWidth = 288;
const windowInset = 8;
const recentBranchCount = 3;
const rowHeight = 28;
const menuPadding = spacing[1];
const headerHeight = 48;
const separatorHeight = 9;
const sectionLabelHeight = 24;
const noticeHeight = 56;
const createFormHeight = 150;
const worktreeFormHeight = 224;
const submenuGap = spacing[2];
const submenuCloseDelayMs = 180;

type Submenu = "worktrees" | "new";
const submenuTriggerId = (group: Submenu): string =>
	group === "worktrees" ? "worktrees" : `${group}-actions`;

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const { colors } = appTokens;

	const styles = StyleSheet.create({
		surface: {
			position: "absolute",
			width: menuWidth,
			backgroundColor: colors.overlay,
			borderRadius: radius.xl,
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
			paddingLeft: spacing[2],
			paddingRight: spacing[2],
			gap: spacing[0.5],
		},
		separator: {
			height: 1,
			flexShrink: 0,
			marginTop: spacing[1],
			marginBottom: spacing[1],
			backgroundColor: colors.border,
		},
		heading: { ...typography.md, fontWeight: fontWeight.medium },
		muted: { ...typography.sm, color: colors.textMuted },
		detail: {
			...typography.xs,
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
			paddingLeft: spacing[2],
			justifyContent: "center",
		},
		input: {
			width: "100%",
			height: 30,
			flexShrink: 0,
			...typography.md,
			paddingLeft: spacing[2.5],
			paddingRight: spacing[2.5],
			borderRadius: radius.md,
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
			paddingLeft: spacing[2],
			paddingRight: spacing[2],
			gap: spacing[2],
			borderRadius: radius.md,
		},
		label: {
			...typography.md,
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
			gap: spacing[1.5],
			flexShrink: 0,
		},
		form: {
			display: "flex",
			flexDirection: "column",
			gap: spacing[2.5],
			padding: spacing[2],
			flexGrow: 1,
			minHeight: 0,
			overflowY: "scroll",
		},
		notice: {
			height: noticeHeight,
			flexShrink: 0,
			padding: spacing[2],
			overflowY: "scroll",
		},
	});

	return { colors, styles };
});

/** Creation flyouts share the workspace menu's hover and keyboard owner. */
function WorkspaceActionSubmenu({
	testId,
	label,
	icon,
	detail,
	open,
	disabled,
	height,
	side,
	menuRef,
	triggerRef,
	onOpen,
	onEnter,
	onLeave,
	children,
}: {
	testId: string;
	label: string;
	icon: "add";
	detail?: string;
	open: boolean;
	disabled: boolean;
	height: number;
	side: "left" | "right";
	menuRef: RefObject<PublicInstance | null>;
	triggerRef: (node: PublicInstance | null) => void;
	onOpen: (focus: boolean) => void;
	onEnter: () => void;
	onLeave: () => void;
	children: ReactNode;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { colors, styles } = themedStyles.get(theme);

	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: rowHeight,
				flexShrink: 0,
			}}
		>
			<Button
				testId={testId}
				ref={triggerRef}
				tokens={appTokens}
				variant="ghost"
				size="sm"
				style={StyleSheet.compose(
					styles.row,
					open && { backgroundColor: colors.surface }
				)}
				disabled={disabled}
				aria-label={label}
				aria-expanded={open}
				aria-disabled={disabled}
				aria-description={`Open the ${label} submenu with Right or Enter.`}
				onMouseEnter={() => onOpen(false)}
				onMouseLeave={onLeave}
				onPress={() => onOpen(true)}
			>
				<WorkspaceTabIcon name={icon} />
				<Text tokens={appTokens} style={styles.label}>
					{label}
				</Text>
				{detail ? (
					<Text tokens={appTokens} style={styles.detail}>
						{detail}
					</Text>
				) : null}
				<WorkspaceTabIcon name="caretRight" />
			</Button>
			{open ? (
				<FloatingLayer
					ref={menuRef}
					testId={`workspace-${testId}`}
					role="group"
					aria-label={label}
					tabIndex={-1}
					side={side}
					sideOffset={submenuGap}
					collisionPadding={windowInset}
					onMouseEnter={onEnter}
					onMouseLeave={onLeave}
					style={StyleSheet.compose(styles.body, {
						height,
						backgroundColor: colors.overlay,
						borderRadius: radius.xl,
					})}
				>
					{children}
				</FloatingLayer>
			) : null}
		</div>
	);
}

export interface WorkspaceMenuActions {
	onSettings?: (id: string) => void;
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
	onSettings,
	worktreesAnchorRef,
	onSubmenuOpen,
	onBusyChange,
	branchIntent,
	onBranchIntentHandled,
}: WorkspaceMenuActions & {
	tab: WorkspaceTabRecord;
	anchor: PublicInstance | undefined;
	dispatch: Dispatch<WorkspaceTabsAction>;
	onClose: () => void;
	worktreesAnchorRef?: Ref<PublicInstance>;
	onSubmenuOpen?: (group: Submenu) => void;
	onBusyChange?: (busy: boolean) => void;
	branchIntent?: "new" | "switch";
	onBranchIntentHandled?: () => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { colors, styles } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const windowSize = useWindowSize();

	const anchorBounds = anchor
		? renderer.getElementBounds?.(anchor.id)
		: undefined;

	const [data, setData] = useState<WorkspaceBranches | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);

	const [mergeSource, setMergeSource] = useState<{
		head: string;
		branch: string;
	} | null>(null);

	const [remoteBranch, setRemoteBranch] = useState<string | null>(null);

	const [branchAction, setBranchAction] = useState<{
		kind: "rename" | "delete";
		name: string;
		oid: string;
	} | null>(null);

	const [changesPrompt, setChangesPrompt] = useState<{
		choice: Omit<BranchRequest, "expectedHead" | "expectedBranch">;
		destination: string;
	} | null>(null);

	const [creatingWorktree, setCreatingWorktree] = useState(false);

	const [removingWorktree, setRemovingWorktree] =
		useState<WorktreeRemoval | null>(null);

	const [expanded, setExpanded] = useState(false);
	const [submenu, setSubmenu] = useState<Submenu | null>(null);
	const [opening, setOpening] = useState(false);
	const mounted = useRef(true);
	const dialog = useRef<PublicInstance>(null);
	const list = useRef<PublicInstance>(null);
	const submenuMenu = useRef<PublicInstance>(null);
	const submenuList = useRef<PublicInstance>(null);
	const submenuFocus = useRef(false);
	// Deferred surfaces can enter before the trigger leaves; do not rely on event order.
	const submenuHovered = useRef(false);
	const hoverClose = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const request = useRef<AbortController | null>(null);
	const repository = tab.workspace.repository;
	const root = repository?.root;
	const head = repository?.head;
	const branch = repository?.branchName;
	const busy = opening || RepositoryWorkspaceModel.isBusy(tab.workspace);

	const actionsVisible =
		!creating &&
		!changesPrompt &&
		!creatingWorktree &&
		!removingWorktree &&
		!mergeSource;

	useLayoutEffect(() => {
		onBusyChange?.(!actionsVisible || busy);
	}, [actionsVisible, busy, onBusyChange]);

	useLayoutEffect(() => () => onBusyChange?.(false), [onBusyChange]);

	const submenuReady = data !== null && actionsVisible;

	const showWorktrees = submenu === "worktrees" && submenuReady && !busy;
	const showNew = submenu === "new" && submenuReady && !busy;

	const { pending: syncKind, version: syncVersion } = tab.workspace.sync;
	const visibleSubmenu = showWorktrees ? "worktrees" : showNew ? "new" : null;

	const dirty = tab.workspace.entries.changes.length > 0;

	const switchBlocked =
		repository?.operation !== "normal" ||
		tab.workspace.entries.changes.some(
			(entry) => entry.change?.recordType === "unmerged"
		) ||
		tab.workspace.commit.needsReview ||
		!!tab.workspace.error ||
		tab.workspace.loading;

	const blocked = dirty || switchBlocked;

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();

			if (hoverClose.current) clearTimeout(hoverClose.current);
		};
	}, []);

	useEffect(() => {
		if (!visibleSubmenu || !submenuFocus.current || !submenuMenu.current)
			return;

		submenuFocus.current = false;
		renderer.focusElement?.(submenuMenu.current.id);
		renderer.focusNextWithin?.(submenuMenu.current.id);
	}, [visibleSubmenu, renderer]);

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

	useEffect(() => {
		if (!branchIntent || !data) return;

		if (branchIntent === "new" && canCreate) {
			setSubmenu("new");
			onSubmenuOpen?.("new");
		}

		onBranchIntentHandled?.();
	}, [branchIntent, canCreate, data, onBranchIntentHandled, onSubmenuOpen]);

	const mergeBranches =
		data?.branches.branches.filter(
			(item) => !(item.type === "local" && item.name === branch)
		) ?? [];

	const canMerge =
		canCreate &&
		!!head &&
		!!branch &&
		!tab.workspace.preview &&
		!tab.workspace.amend &&
		mergeBranches.length > 0;

	const savedChanges =
		data?.savedChanges?.filter((item) => item.branch === branch) ?? [];

	const canRestore = !busy && !blocked && savedChanges.length > 0;
	const canCompare = !busy && !!head && data !== null;

	const canCreateWorktree =
		!busy &&
		!!head &&
		repository?.operation === "normal" &&
		!tab.workspace.loading &&
		!tab.workspace.error &&
		!tab.workspace.commit.needsReview &&
		data !== null;

	const worktrees = data?.worktrees.filter((item) => !item.prunable) ?? [];
	const worktreeIds = worktrees.map((item) => `worktree-${item.path}`);

	const newIds = [
		...(canCreate ? ["create-branch"] : []),
		...(onCreateWorktree && canCreateWorktree ? ["create-worktree"] : []),
	];

	const canNew = newIds.length > 0;

	const submenuIds =
		visibleSubmenu === "worktrees"
			? worktreeIds
			: visibleSubmenu === "new"
				? newIds
				: [];

	const submenuRowIds =
		visibleSubmenu === "worktrees"
			? worktreeIds
			: visibleSubmenu === "new"
				? ["create-branch", "create-worktree"]
				: [];

	const cancelSubmenuClose = (): void => {
		if (hoverClose.current) clearTimeout(hoverClose.current);

		hoverClose.current = null;
	};

	const closeSubmenu = (restoreFocus = false): void => {
		cancelSubmenuClose();
		submenuFocus.current = false;
		submenuHovered.current = false;
		setSubmenu(null);

		if (restoreFocus && submenu) {
			const trigger = rows.current.get(submenuTriggerId(submenu));

			if (trigger) renderer.focusElement?.(trigger.id);
		}
	};

	const openSubmenu = (group: Submenu, focus = false): void => {
		if (group === "new" ? !canNew : busy || !data) return;

		cancelSubmenuClose();
		submenuFocus.current = focus;
		submenuHovered.current = false;
		setSubmenu(group);
		onSubmenuOpen?.(group);

		if (visibleSubmenu === group && focus && submenuMenu.current) {
			submenuFocus.current = false;
			renderer.focusElement?.(submenuMenu.current.id);
			renderer.focusNextWithin?.(submenuMenu.current.id);
		}
	};

	const openWorktrees = (focus = false): void =>
		openSubmenu("worktrees", focus);

	const scheduleSubmenuClose = (): void => {
		cancelSubmenuClose();
		hoverClose.current = setTimeout(() => {
			hoverClose.current = null;

			if (submenuHovered.current) return;

			const focused = renderer.getFocusedElementId?.();

			closeSubmenu(
				submenuRowIds.some((id) => rows.current.get(id)?.id === focused)
			);
		}, submenuCloseDelayMs);
	};

	const enabledIds = visibleBranches
		.filter(
			(item) =>
				!busy &&
				((item.type === "local" && item.name === branch) ||
					(!switchBlocked &&
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

	if (canRestore) enabledIds.push("restore-branch-changes");

	if (!busy && hasMore) enabledIds.push("more-branches");

	if (!busy && data) enabledIds.push("worktrees");

	if (canCompare) enabledIds.push("compare-branches");

	if (canNew) enabledIds.push("new-actions");

	if (canMerge) enabledIds.push("merge-branch");

	if (onSettings && !busy) enabledIds.push("repository-settings");

	const notice =
		error ??
		tab.workspace.error ??
		(busy && !syncKind ? "Updating workspace…" : null);

	// Fixed header/action rows surround a scrollable list; the expanded menu stays inside the window.
	const contentHeight = mergeSource
		? 440
		: changesPrompt
			? changesPrompt.choice.kind === "restore"
				? 164
				: 300
			: removingWorktree
				? 230
				: creatingWorktree
					? worktreeFormHeight
					: creating
						? createFormHeight
						: menuPadding * 2 +
							headerHeight +
							separatorHeight * 2 +
							rowHeight +
							(savedChanges.length ? rowHeight : 0) +
							(onSettings ? separatorHeight + rowHeight : 0) +
							rowHeight +
							Math.max(1, visibleBranches.length) * rowHeight +
							(hasMore ? rowHeight : 0) +
							rowHeight;

	const menuHeight = Math.min(
		expanded || mergeSource ? maxExpandedMenuHeight : maxMenuHeight,
		windowSize.height -
			(anchorBounds?.y ?? 0) -
			workspaceLayout.tabHeight -
			windowInset,
		contentHeight + (notice ? noticeHeight : 0)
	);

	const showActions = (): void => {
		closeSubmenu();
		setCreating(false);
		setMergeSource(null);
		setRemoteBranch(null);
		setBranchAction(null);
		setChangesPrompt(null);
		setCreatingWorktree(false);
		setRemovingWorktree(null);
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
		if (
			(creatingWorktree || removingWorktree || changesPrompt || mergeSource) &&
			event.key !== "escape"
		)
			return;

		const focused = renderer.getFocusedElementId?.();

		const inSubmenu =
			!!visibleSubmenu &&
			submenuRowIds.some((id) => rows.current.get(id)?.id === focused);

		if (visibleSubmenu && (event.key === "escape" || event.key === "left")) {
			closeSubmenu(true);

			return;
		}

		if (event.key === "right") {
			for (const group of ["worktrees", "new"] as const) {
				if (rows.current.get(submenuTriggerId(group))?.id === focused) {
					openSubmenu(group, true);

					return;
				}
			}
		}

		if (event.key === "escape" || event.key === "tab") {
			if (
				event.key === "escape" &&
				(creating ||
					creatingWorktree ||
					removingWorktree ||
					mergeSource ||
					changesPrompt) &&
				!busy
			)
				showActions();
			else onClose();

			return;
		}

		if (
			creating ||
			changesPrompt ||
			(event.key !== "down" && event.key !== "up")
		)
			return;

		const activeIds = inSubmenu ? submenuIds : enabledIds;

		if (!inSubmenu) closeSubmenu();

		const focusedIndex = activeIds.findIndex(
			(id) => rows.current.get(id)?.id === focused
		);

		const index = focusedIndex < 0 && event.key === "up" ? 0 : focusedIndex;

		const next =
			activeIds[
				(index + (event.key === "down" ? 1 : -1) + activeIds.length) %
					activeIds.length
			];

		const node = next ? rows.current.get(next) : undefined;

		if (node) {
			renderer.focusElement?.(node.id);

			const scrollList = inSubmenu ? submenuList.current : list.current;

			if (
				!scrollList ||
				next === "worktrees" ||
				next === "new-actions" ||
				next === "create-branch" ||
				next === "merge-branch" ||
				next === "create-worktree" ||
				next === "repository-settings"
			)
				return;

			const viewport = renderer.getElementBounds?.(scrollList.id);
			const target = renderer.getElementBounds?.(node.id);

			if (!viewport || !target) return;

			const offset = renderer.getScrollOffset?.(scrollList.id)?.[1] ?? 0;
			// As in RepositoryList, GPUIX bounds include the scroll offset; recover the clip origin.
			const top = viewport.y - offset;

			const delta =
				target.y < top
					? target.y - top
					: Math.max(0, target.y + target.height - top - viewport.height);

			renderer.scrollTo?.(scrollList.id, 0, offset - delta);
		}
	};

	const submitBranch = async (
		choice: Omit<BranchRequest, "expectedHead" | "expectedBranch">,
		destination: string
	): Promise<void> => {
		if (busy || switchBlocked) return;

		setError(null);
		const message = await onChangeBranch(tab.id, choice);

		if (!mounted.current) return;

		if (message) {
			setError(message);
			// After a failed apply, never offer to run the checkout again over partially restored work.
			setChangesPrompt(null);
			setCreating(false);
			setRemoteBranch(null);
		} else {
			const saved =
				choice.kind !== "restore" &&
				data?.savedChanges?.find((item) => item.branch === destination);

			if (saved && choice.changes !== "bring") {
				setCreating(false);
				setChangesPrompt({
					destination,
					choice: {
						kind: "restore",
						name: destination,
						savedChangesOid: saved.oid,
					},
				});
			} else onClose();
		}
	};

	const change = async (name: string): Promise<void> => {
		if (
			busy ||
			switchBlocked ||
			!name.trim() ||
			(blocked && (branchAction || (creating && !remoteBranch)))
		)
			return;

		const choice: Omit<BranchRequest, "expectedHead" | "expectedBranch"> =
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
					};

		if (dirty) {
			closeSubmenu();
			setChangesPrompt({
				destination: name.trim(),
				choice: {
					...choice,
					reviewedSource: { head: head ?? null, branch: branch ?? null },
				},
			});

			return;
		}

		await submitBranch(choice, name.trim());
	};

	const openWorktree = async (path: string): Promise<void> => {
		if (busy) return;

		if (path === root) {
			onClose();

			return;
		}

		closeSubmenu();
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

	const submenuTrigger = submenu
		? rows.current.get(submenuTriggerId(submenu))
		: undefined;

	const triggerBounds = submenuTrigger
		? renderer.getElementBounds?.(submenuTrigger.id)
		: undefined;

	const submenuSide =
		(triggerBounds?.x ?? menuLeft) +
			(triggerBounds?.width ?? menuWidth) +
			submenuGap +
			menuWidth <=
		windowSize.width - windowInset
			? "right"
			: "left";

	const submenuHeight = Math.min(
		maxWorktreeMenuHeight,
		windowSize.height - windowInset * 2,
		menuPadding * 2 + Math.max(1, worktrees.length) * rowHeight
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
					{mergeSource && data ? (
						<WorkspaceMergeForm
							branch={mergeSource.branch}
							branches={mergeBranches}
							busy={busy}
							disabled={
								!canMerge ||
								head !== mergeSource.head ||
								branch !== mergeSource.branch
							}
							onCancel={showActions}
							onMerge={(target, kind, message) => {
								void (async () => {
									if (!canMerge) return;

									setError(null);
									await onChangeBranch(tab.id, {
										kind,
										...(kind === "squash-merge" ? { message } : {}),
										name: target.fullName,
										expectedTarget: target.oid,
										reviewedSource: mergeSource,
									});

									// The window refreshes even failed merges; Changes owns recovery and conflicts.
									if (mounted.current) onClose();
								})();
							}}
						/>
					) : changesPrompt ? (
						<WorkspaceBranchChangesForm
							key={`${changesPrompt.choice.kind}:${changesPrompt.destination}`}
							name={changesPrompt.destination}
							source={
								changesPrompt.choice.reviewedSource?.branch ??
								branch ??
								"this branch"
							}
							restore={changesPrompt.choice.kind === "restore"}
							busy={busy}
							onCancel={showActions}
							onConfirm={(changes) => {
								void submitBranch(
									{
										...changesPrompt.choice,
										...(changesPrompt.choice.kind !== "restore" && { changes }),
									},
									changesPrompt.destination
								);
							}}
						/>
					) : removingWorktree && onRemoveWorktree ? (
						<div style={{ ...styles.form, minHeight: 0, overflowY: "scroll" }}>
							<Text tokens={appTokens} style={styles.heading}>
								Remove worktree?
							</Text>
							<Text tokens={appTokens} style={{ ...typography.sm }}>
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
									disabled={
										(remoteBranch ? busy || switchBlocked : !canCreate) ||
										!name.trim()
									}
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
					) : (
						<>
							<div
								style={StyleSheet.compose(styles.header, {
									paddingRight: spacing[20],
								})}
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
												(!current && (switchBlocked || !!item.worktreePath))
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
												color={current ? colors.focusRing : colors.textMuted}
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
										onPress={() => {
											closeSubmenu();
											setExpanded((value) => !value);
										}}
									>
										<Text tokens={appTokens} style={styles.label}>
											More
										</Text>
										<WorkspaceTabIcon
											name={expanded ? "caretDown" : "caretRight"}
										/>
									</Button>
								) : null}
							</div>
							<div
								style={{
									position: "relative",
									width: "100%",
									height: rowHeight,
									flexShrink: 0,
								}}
							>
								<Button
									testId="worktrees"
									ref={(node) => {
										setRefs(node, worktreesAnchorRef);

										if (node) rows.current.set("worktrees", node);
										else rows.current.delete("worktrees");
									}}
									tokens={appTokens}
									variant="ghost"
									size="sm"
									style={StyleSheet.compose(
										styles.row,
										showWorktrees && { backgroundColor: colors.surface }
									)}
									disabled={busy || !data}
									aria-label="Worktrees"
									aria-expanded={showWorktrees}
									aria-description="Open the worktree submenu with Right or Enter."
									onMouseEnter={() => openWorktrees()}
									onMouseLeave={scheduleSubmenuClose}
									onPress={() => openWorktrees(true)}
								>
									<WorkspaceTabIcon name="branch" />
									<Text tokens={appTokens} style={styles.label}>
										Worktrees
									</Text>
									<WorkspaceTabIcon name="caretRight" />
								</Button>
								{showWorktrees ? (
									<FloatingLayer
										ref={submenuMenu}
										testId="workspace-worktrees"
										role="group"
										aria-label="Worktrees"
										tabIndex={-1}
										side={submenuSide}
										sideOffset={submenuGap}
										collisionPadding={windowInset}
										onMouseEnter={() => {
											submenuHovered.current = true;
											cancelSubmenuClose();
										}}
										onMouseLeave={() => {
											submenuHovered.current = false;
											scheduleSubmenuClose();
										}}
										style={StyleSheet.compose(styles.body, {
											height: submenuHeight,
											backgroundColor: colors.overlay,
											borderRadius: radius.xl,
										})}
									>
										<div
											ref={submenuList}
											testId="workspace-worktree-list"
											style={styles.list}
										>
											{!worktrees.length ? (
												<Text tokens={appTokens} style={styles.muted}>
													No worktrees available.
												</Text>
											) : null}
											{worktrees.map((item) => {
												const id = `worktree-${item.path}`;
												const current = item.path === root;

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
														aria-label={`Open ${item.branch?.replace(/^refs\/heads\//, "") ?? "detached HEAD"} worktree${current ? ", current worktree" : ""}`}
														aria-description={MachineLocation.display(
															item.path
														)}
														onContextMenu={
															onRemoveWorktree
																? (event) => {
																		try {
																			const enabled =
																				canCreateWorktree &&
																				!MachineLocation.isRemote(
																					repository?.root ?? ""
																				) &&
																				!current &&
																				!item.locked &&
																				!item.prunable &&
																				item.path !== data?.worktrees[0]?.path;

																			const bounds =
																				renderer.getElementBounds?.(
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
																			closeSubmenu();
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
														<WorkspaceTabIcon
															name={current ? "check" : "branch"}
															color={
																current ? colors.focusRing : colors.textMuted
															}
														/>
														<Text tokens={appTokens} style={styles.label}>
															{item.branch?.replace(/^refs\/heads\//, "") ??
																"Detached HEAD"}
														</Text>
														<Text tokens={appTokens} style={styles.detail}>
															{current ? "Current" : basename(item.path)}
														</Text>
													</Button>
												);
											})}
										</div>
									</FloatingLayer>
								) : null}
							</div>
							<div style={styles.separator} />
							{savedChanges.length ? (
								<Button
									testId="restore-branch-changes"
									ref={(node) => {
										if (node) rows.current.set("restore-branch-changes", node);
										else rows.current.delete("restore-branch-changes");
									}}
									tokens={appTokens}
									variant="ghost"
									size="sm"
									style={styles.row}
									disabled={!canRestore}
									onPress={() => {
										const saved = savedChanges[0];

										if (saved && branch)
											setChangesPrompt({
												destination: branch,
												choice: {
													kind: "restore",
													name: branch,
													savedChangesOid: saved.oid,
													reviewedSource: { head: head ?? null, branch },
												},
											});
									}}
								>
									<WorkspaceTabIcon name="branch" />
									<Text tokens={appTokens} style={styles.label}>
										Restore saved changes…
									</Text>
								</Button>
							) : null}
							<WorkspaceActionSubmenu
								testId="new-actions"
								label="New"
								icon="add"
								open={showNew}
								disabled={!canNew}
								height={
									menuPadding * 2 + rowHeight * (onCreateWorktree ? 2 : 1)
								}
								side={submenuSide}
								menuRef={submenuMenu}
								triggerRef={(node) => {
									if (node) rows.current.set("new-actions", node);
									else rows.current.delete("new-actions");
								}}
								onOpen={(focus) => openSubmenu("new", focus)}
								onEnter={() => {
									submenuHovered.current = true;
									cancelSubmenuClose();
								}}
								onLeave={scheduleSubmenuClose}
							>
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
										closeSubmenu();
										setCreating(true);
										setName("");
										setError(null);
									}}
								>
									<WorkspaceTabIcon name="add" />
									<Text tokens={appTokens} style={styles.label}>
										New branch…
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
											closeSubmenu();
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
							</WorkspaceActionSubmenu>
							<Button
								testId="merge-branch"
								ref={(node) => {
									if (node) rows.current.set("merge-branch", node);
									else rows.current.delete("merge-branch");
								}}
								tokens={appTokens}
								variant="ghost"
								size="sm"
								style={styles.row}
								disabled={!canMerge}
								aria-description={
									dirty
										? "Commit or stash your changes before merging."
										: "Merge another branch into the current branch without switching."
								}
								onPress={() => {
									if (!canMerge || !head || !branch) return;

									closeSubmenu();
									setError(null);
									setMergeSource({ head, branch });
								}}
							>
								<WorkspaceTabIcon name="branch" />
								<Text tokens={appTokens} style={styles.label}>
									Merge or rebase…
								</Text>
							</Button>
							{onSettings ? (
								<>
									<div style={styles.separator} />
									<Button
										testId="repository-settings"
										ref={(node) => {
											if (node) rows.current.set("repository-settings", node);
											else rows.current.delete("repository-settings");
										}}
										tokens={appTokens}
										variant="ghost"
										size="sm"
										style={styles.row}
										disabled={busy}
										onPress={() => {
											closeSubmenu();
											onClose();
											onSettings(tab.id);
										}}
									>
										<WorkspaceTabIcon name="branch" />
										<Text tokens={appTokens} style={styles.label}>
											Repository settings…
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

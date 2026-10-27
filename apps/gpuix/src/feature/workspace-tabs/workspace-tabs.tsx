import { useAppTheme } from "../../styles/theme";
import { controlSize, iconSize, radius, spacing } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type Ref,
} from "react";
import type { NativeRenderer } from "@gpuix/native/host";

import { workspaceLayout as layout } from "../../styles/workspace-layout";
import { useWorkspaceCorner } from "../../fixture/workspace-corner";
import {
	WorkspaceTab,
	WorkspaceTabSelection,
} from "./components/workspace-tab";
import { WorkspaceTabIcon } from "./components/workspace-tab-icon";
import {
	WorkspaceMenu,
	type WorkspaceMenuActions,
} from "./components/workspace-menu";
import { RepositoryWorkspaceModel } from "../repository-workspace/lib/repository-workspace-model";
import { useWorkspaceTabDrag } from "./hooks/use-workspace-tab-drag";
import {
	WorkspaceTabsModel,
	type WorkspaceTabsAction,
	type WorkspaceTabsState,
} from "./lib/workspace-tabs-model";

const homeSlotWidth = controlSize.rail - spacing[2];
const homeScrollInset = controlSize.rail + spacing[1] - homeSlotWidth;

const styles = StyleSheet.create({
	toolbar: {
		position: "relative",
		width: "100%",
		display: "flex",
		flexDirection: "row",
		alignItems: "end",
		height: layout.toolbarHeight,
		flexShrink: 0,
		paddingLeft: layout.desktopTitlebarControlsWidth,
		paddingRight: layout.workspaceSurfaceInset,
	},
	tabsClip: {
		display: "flex",
		flexDirection: "row",
		alignItems: "end",
		flexGrow: 1,
		flexBasis: 0,
		minWidth: 0,
		height: layout.tabHeight,
		// Clip at the inset surface edge, not at the outer AppKit window edge.
		borderTopRightRadius: layout.workspaceSurfaceRadius,
		overflowX: "hidden",
		overflowY: "hidden",
	},
	tabs: {
		display: "flex",
		flexDirection: "row",
		alignItems: "end",
		minWidth: 0,
		flexGrow: 1,
		flexBasis: 0,
		flexShrink: 1,
		height: layout.toolbarHeight,
		// Keep both shoulders inside the scroll clip without moving the tab bodies.
		paddingLeft: layout.tabSurfaceOutset,
		paddingRight: layout.tabSurfaceOutset,
		overflowX: "scroll",
		overflowY: "hidden",
	},
	rail: {
		position: "relative",
		height: layout.tabHeight,
		flexShrink: 0,
		pointerEvents: "none",
	},
	homeSlot: {
		position: "relative",
		// The first tab's transparent shoulder provides the compact resting gap.
		width: homeSlotWidth,
		height: controlSize.rail,
		flexShrink: 0,
		marginBottom: spacing[1],
	},
	// Keep the button in flow so the tooltip anchor retains its full bounds.
	homeAnchor: {
		position: "absolute",
		left: 0,
		top: 0,
	},
	home: {
		width: controlSize.rail,
		height: controlSize.rail,
		borderRadius: radius.lg,
		borderWidth: 0,
		paddingLeft: spacing[0],
		paddingRight: spacing[0],
	},
});

function updateWorkspaceCorner(
	renderer: NativeRenderer,
	instance: PublicInstance | null,
	activeLeft: number | undefined,
	windowWidth: number,
	setRadius: (radius: number) => void,
	scrollX?: number
): void {
	const viewport = instance && renderer.getElementBounds?.(instance.id);
	const radius = layout.workspaceSurfaceRadius;

	if (!instance || !viewport || activeLeft === undefined) {
		setRadius(radius);

		return;
	}

	const offset = scrollX ?? renderer.getScrollOffset?.(instance.id)?.[0] ?? 0;
	const left = viewport.x + activeLeft + offset;
	const right = left + layout.tabWidth + layout.tabSurfaceOutset * 2;

	const visibleLeft = Math.max(left, viewport.x);
	const visibleRight = Math.min(right, viewport.x + viewport.width);

	const clearance = windowWidth - layout.workspaceSurfaceInset - visibleRight;

	const progress =
		visibleRight > visibleLeft
			? Math.max(0, Math.min(1, clearance / radius))
			: 1;

	// A clipped tab still joins the edge; only its visible surface matters.
	setRadius(radius * progress * progress * (3 - 2 * progress));
}

/** Horizontal, roving-focus tab strip. State transitions stay in the app's reducer. */
export function WorkspaceTabs({
	state,
	dispatch,
	readBranches,
	readRepository,
	onChangeBranch,
	onCreateWorktree,
	onRemoveWorktree,
	onSettings,
	onTourAnchor,
	onTabMenuOpenChange,
	worktreesAnchorRef,
	onWorktreesOpen,
	onMenuBusyChange,
	closeDisabledId,
	onCloseSettings,
	openMenuFor,
	onOpenMenuFor,
	branchIntent,
}: {
	state: WorkspaceTabsState;
	dispatch: Dispatch<WorkspaceTabsAction>;
	onTourAnchor?: (instance: PublicInstance | null) => void;
	onTabMenuOpenChange?: (open: boolean) => void;
	worktreesAnchorRef?: Ref<PublicInstance>;
	onWorktreesOpen?: () => void;
	onMenuBusyChange?: (busy: boolean) => void;
	closeDisabledId?: string;
	onCloseSettings?: () => void;
	/** Request the existing branch/worktree menu from a command action. */
	openMenuFor?: string | null;
	onOpenMenuFor?: () => void;
	branchIntent?: "new" | "switch";
} & Partial<WorkspaceMenuActions>) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;

	const renderer = useGpuixRequired();
	const { width: windowWidth } = useWindowSize();
	const setRightRadius = useWorkspaceCorner();
	const tabs = useRef(new Map<string, PublicInstance>());
	const frames = useRef(new Map<string, PublicInstance>());
	const strip = useRef<PublicInstance>(null);
	const rail = useRef<PublicInstance>(null);
	const homeButton = useRef<PublicInstance>(null);
	const focusRequested = useRef(false);
	const previousActiveId = useRef(state.activeId);
	const [menuId, setMenuId] = useState<string | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const clipInset = scrolled ? homeScrollInset : 0;
	const drag = useWorkspaceTabDrag(state, dispatch, strip, rail);
	const { draggingId, settlingId } = drag;
	const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeId);
	// GPUIX paints in child order. Keep the moving surface above its neighbors
	// without reparenting it and losing pointer capture or keyboard focus.
	const frontId = draggingId ?? settlingId ?? state.activeId;

	const positionedTabs = drag.tabs
		.map((tab, index) => ({
			tab,
			left: tab.id === draggingId ? drag.left : index * layout.tabWidth,
		}))
		.sort(
			(a, b) => Number(a.tab.id === frontId) - Number(b.tab.id === frontId)
		);

	const activeLeft = positionedTabs.find(
		({ tab }) => tab.id === state.activeId
	)?.left;

	useEffect(
		() => () => setRightRadius(layout.workspaceSurfaceRadius),
		[setRightRadius]
	);

	const onPointerDown = (): void => {
		drag.resetInput();
	};

	const onKeyboardInput = (): void => {
		drag.resetInput();
	};

	const focusTab = (id: string): void => {
		const tab = tabs.current.get(id);

		if (!tab) return;

		renderer.focusElement?.(tab.id);
	};

	useEffect(() => {
		if (previousActiveId.current !== state.activeId) {
			previousActiveId.current = state.activeId;
			const target = state.activeId
				? tabs.current.get(state.activeId)
				: homeButton.current;

			if (target) renderer.focusElement?.(target.id);
		}

		if (focusRequested.current) {
			focusRequested.current = false;
			const target = state.activeId
				? tabs.current.get(state.activeId)
				: homeButton.current;

			if (target) renderer.focusElement?.(target.id);
		}

		const offset = strip.current
			? (renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0)
			: 0;

		if (draggingId || settlingId || activeIndex < 0) {
			setScrolled(offset < 0);
			updateWorkspaceCorner(
				renderer,
				strip.current,
				activeLeft,
				windowWidth,
				setRightRadius,
				offset
			);

			return;
		}

		if (!strip.current) return;

		const viewport = renderer.getElementBounds?.(strip.current.id);

		if (!viewport) return;

		const left = activeIndex * layout.tabWidth;
		const visibleWidth = viewport.width - layout.tabSurfaceOutset * 2;

		// GPUIX 0.10 scrollIntoView can leave a new horizontal tab offscreen.
		// Reveal the whole slot with paint room for its shoulders at either edge.
		const nextOffset = Math.max(
			0,
			left + layout.tabWidth - visibleWidth,
			Math.min(left, -offset)
		);

		renderer.scrollTo?.(strip.current.id, -nextOffset, 0);
		setScrolled(nextOffset > 0);
		updateWorkspaceCorner(
			renderer,
			strip.current,
			activeLeft,
			windowWidth,
			setRightRadius,
			-nextOffset
		);
	}, [
		renderer,
		state.activeId,
		state.tabs.length,
		activeIndex,
		draggingId,
		settlingId,
		activeLeft,
		windowWidth,
		setRightRadius,
	]);

	useLayoutEffect(() => {
		onTourAnchor?.(
			state.activeId ? (frames.current.get(state.activeId) ?? null) : null
		);
	}, [onTourAnchor, state.activeId, state.tabs.length]);

	const menuOpen = !!menuId && menuId === state.activeId;

	useLayoutEffect(() => {
		onTabMenuOpenChange?.(menuOpen);
	}, [menuOpen, onTabMenuOpenChange]);

	useLayoutEffect(
		() => () => {
			onTourAnchor?.(null);
			onTabMenuOpenChange?.(false);
		},
		[onTourAnchor, onTabMenuOpenChange]
	);

	useEffect(() => {
		if (!openMenuFor || !state.tabs.some((tab) => tab.id === openMenuFor))
			return;

		setMenuId(openMenuFor);
	}, [openMenuFor, state.tabs]);

	return (
		<div testId="workspace-toolbar" style={styles.toolbar}>
			<div
				testId="window-drag-region"
				windowDrag
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: layout.toolbarHeight - layout.tabHeight,
				}}
			/>
			<div style={styles.homeSlot}>
				<TooltipProvider delayDuration={350}>
					<Tooltip style={styles.homeAnchor}>
						<TooltipTrigger asChild>
							<Button
								ref={homeButton}
								testId="workspace-home"
								aria-label="Home"
								aria-description={
									state.activeId === null
										? "Welcome screen selected"
										: "Show welcome screen"
								}
								tokens={appTokens}
								variant="ghost"
								size="sm"
								focusVisible={false}
								onMouseDown={onPointerDown}
								onKeyDown={(event) => {
									onKeyboardInput();
									const first = state.tabs[0];

									if (
										event.key === "right" &&
										first &&
										!event.modifiers?.cmd &&
										!event.modifiers?.ctrl &&
										!event.modifiers?.alt &&
										!event.modifiers?.shift
									) {
										dispatch({ type: "activate", id: first.id });
										focusTab(first.id);
									}
								}}
								style={StyleSheet.compose(
									styles.home,
									state.activeId === null && {
										backgroundColor: appColors.editorHairline,
									}
								)}
								onPress={() => {
									if (drag.shouldSuppressClick()) return;

									setMenuId(null);
									drag.cancel();
									focusRequested.current = state.activeId !== null;
									dispatch({ type: "home" });
								}}
							>
								<WorkspaceTabIcon
									name="home"
									size={iconSize.lg}
									testId="workspace-home-icon"
									color={
										state.activeId === null
											? appColors.editorInk
											: appColors.editorMuted
									}
								/>
							</Button>
						</TooltipTrigger>
						<TooltipContent
							testId="workspace-home-tooltip"
							tokens={appTokens}
							side="bottom"
							align="center"
						>
							Home
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div
				testId="workspace-tabs-clip"
				style={StyleSheet.compose(styles.tabsClip, { marginLeft: clipInset })}
			>
				<div
					ref={strip}
					testId="workspace-tabs"
					role="tablist"
					aria-label="Workspaces"
					// Move only the clip boundary, not the tabs or native scroll coordinates.
					style={StyleSheet.compose(styles.tabs, { marginLeft: -clipInset })}
					onScroll={() => {
						const offset = strip.current
							? (renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0)
							: 0;

						setScrolled(offset < 0);
						updateWorkspaceCorner(
							renderer,
							strip.current,
							activeLeft,
							windowWidth,
							setRightRadius,
							offset
						);
					}}
				>
					<div
						ref={rail}
						style={StyleSheet.compose(styles.rail, {
							width: state.tabs.length * layout.tabWidth,
						})}
					>
						{theme.smoothTransitions &&
						state.activeId &&
						activeLeft !== undefined ? (
							<WorkspaceTabSelection
								id={state.activeId}
								left={activeLeft}
								dragging={!!draggingId}
							/>
						) : null}
						{positionedTabs.map(({ tab, left }) => (
							<WorkspaceTab
								key={tab.id}
								tab={tab}
								active={state.activeId === tab.id}
								menuAvailable={
									tab.kind === "repository" &&
									!!tab.workspace.repository &&
									!!onChangeBranch
								}
								menuOpen={menuId === tab.id && state.activeId === tab.id}
								onDismissMenu={() => setMenuId(null)}
								onPointerDown={onPointerDown}
								dragging={drag.draggingId === tab.id}
								left={left}
								onMotionComplete={() => drag.onMotionComplete(tab.id)}
								onTabMouseDown={(event, frame) => {
									onPointerDown();
									drag.onMouseDown(tab.id, event, frame);

									if (event.button === 0) focusTab(tab.id);
								}}
								onTabMouseMove={(event) => {
									drag.onMouseMove(event);

									if (drag.shouldSuppressClick()) setMenuId(null);
								}}
								onTabMouseUp={drag.onMouseUp}
								onCancelDrag={() => drag.cancel(tab.id)}
								onKeyboardInput={onKeyboardInput}
								tabRef={(instance) => {
									if (instance) tabs.current.set(tab.id, instance);
									else tabs.current.delete(tab.id);
								}}
								frameRef={(instance) => {
									if (instance) frames.current.set(tab.id, instance);
									else frames.current.delete(tab.id);
								}}
								onActivate={() => {
									if (drag.shouldSuppressClick()) return;

									if (
										state.activeId === tab.id &&
										tab.workspace.repository &&
										onChangeBranch
									)
										setMenuId(tab.id);
									else {
										setMenuId(null);
										dispatch({ type: "activate", id: tab.id });
									}

									focusTab(tab.id);
								}}
								closeDisabled={closeDisabledId === tab.id}
								onClose={() => {
									if (
										closeDisabledId === tab.id ||
										drag.shouldSuppressClick() ||
										RepositoryWorkspaceModel.isBusy(tab.workspace)
									)
										return;

									if (tab.kind === "settings" && onCloseSettings) {
										onCloseSettings();

										return;
									}

									focusRequested.current = true;
									setMenuId(null);
									dispatch({ type: "close", id: tab.id });
								}}
								onNavigate={(key) => {
									setMenuId(null);
									const id = WorkspaceTabsModel.destination(
										state.tabs,
										tab.id,
										key
									);

									if (!id) return;

									dispatch({ type: "activate", id });
									focusTab(id);
								}}
								onReorder={(key) => {
									setMenuId(null);
									drag.cancel();
									const index = state.tabs.findIndex(
										(item) => item.id === tab.id
									);

									const neighbor =
										state.tabs[index + (key === "left" ? -1 : 1)];

									if (!neighbor) return;

									dispatch({
										type: "reorder",
										id: tab.id,
										overId: neighbor.id,
									});
									focusTab(tab.id);
								}}
							>
								{menuId === tab.id &&
								state.activeId === tab.id &&
								readBranches &&
								readRepository &&
								onChangeBranch ? (
									<WorkspaceMenu
										tab={tab}
										anchor={frames.current.get(tab.id)}
										dispatch={dispatch}
										readBranches={readBranches}
										readRepository={readRepository}
										onChangeBranch={onChangeBranch}
										onCreateWorktree={onCreateWorktree}
										onRemoveWorktree={onRemoveWorktree}
										worktreesAnchorRef={worktreesAnchorRef}
										onSubmenuOpen={(group) => {
											if (group === "worktrees") onWorktreesOpen?.();
										}}
										branchIntent={
											branchIntent && tab.id === openMenuFor
												? branchIntent
												: undefined
										}
										onBranchIntentHandled={onOpenMenuFor}
										onBusyChange={onMenuBusyChange}
										onSettings={onSettings}
										onClose={() => {
											setMenuId(null);
											focusRequested.current = true;
											focusTab(tab.id);
										}}
									/>
								) : null}
							</WorkspaceTab>
						))}
					</div>
					<div
						testId="empty-titlebar"
						windowDrag
						style={{ flexGrow: 1, flexShrink: 0, height: "100%" }}
					/>
				</div>
			</div>
		</div>
	);
}

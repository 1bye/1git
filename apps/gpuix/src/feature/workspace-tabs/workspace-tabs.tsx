import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState, type Dispatch } from "react";

import { appTokens } from "../../styles/tokens";
import { workspaceLayout as layout } from "../../styles/workspace-layout";
import { WorkspaceTab } from "./components/workspace-tab";
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

const styles = StyleSheet.create({
	toolbar: {
		position: "relative",
		width: "100%",
		display: "flex",
		flexDirection: "row",
		alignItems: "end",
		height: layout.toolbarHeight,
		flexShrink: 0,
		paddingLeft: layout.desktopTitlebarControlsWidth - layout.tabSurfaceOutset,
		paddingRight: layout.workspaceSurfaceInset,
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
	add: {
		width: layout.tabCloseSize,
		height: layout.tabCloseSize,
		marginLeft: 4,
		marginRight: 4,
		marginBottom: layout.tabContentInsetBlock,
		paddingLeft: 0,
		paddingRight: 0,
	},
});

/** Horizontal, roving-focus tab strip. State transitions stay in the app's reducer. */
export function WorkspaceTabs({
	state,
	dispatch,
	readBranches,
	readRepository,
	onChangeBranch,
}: {
	state: WorkspaceTabsState;
	dispatch: Dispatch<WorkspaceTabsAction>;
} & Partial<WorkspaceMenuActions>) {
	const renderer = useGpuixRequired();
	const tabs = useRef(new Map<string, PublicInstance>());
	const frames = useRef(new Map<string, PublicInstance>());
	const strip = useRef<PublicInstance>(null);
	const addButton = useRef<PublicInstance>(null);
	const focusRequested = useRef(false);
	const [focusVisible, setFocusVisible] = useState(true);
	const [menuId, setMenuId] = useState<string | null>(null);
	const drag = useWorkspaceTabDrag(state, dispatch, strip);
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

	const onPointerDown = (): void => {
		drag.resetInput();
		setFocusVisible(false);
	};

	const onKeyboardInput = (): void => {
		drag.resetInput();
		setFocusVisible(true);
	};

	const focusTab = (id: string): void => {
		const tab = tabs.current.get(id);

		if (!tab) return;

		renderer.focusElement?.(tab.id);
	};

	useEffect(() => {
		if (focusRequested.current) {
			focusRequested.current = false;
			const target = state.activeId
				? tabs.current.get(state.activeId)
				: addButton.current;

			if (target) renderer.focusElement?.(target.id);
		}

		if (draggingId || settlingId) return;

		if (!strip.current || activeIndex < 0) return;

		const viewport = renderer.getElementBounds?.(strip.current.id);

		if (!viewport) return;

		const offset = renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0;
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
	}, [
		renderer,
		state.activeId,
		state.tabs.length,
		activeIndex,
		draggingId,
		settlingId,
	]);

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
			<div
				ref={strip}
				testId="workspace-tabs"
				role="tablist"
				aria-label="Workspaces"
				style={styles.tabs}
			>
				<div
					style={StyleSheet.compose(styles.rail, {
						width: state.tabs.length * layout.tabWidth,
					})}
				>
					{positionedTabs.map(({ tab, left }) => (
						<WorkspaceTab
							key={tab.id}
							tab={tab}
							active={state.activeId === tab.id}
							menuAvailable={!!tab.workspace.repository && !!onChangeBranch}
							menuOpen={menuId === tab.id && state.activeId === tab.id}
							onDismissMenu={() => setMenuId(null)}
							focusVisible={focusVisible}
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
							onClose={() => {
								if (
									drag.shouldSuppressClick() ||
									RepositoryWorkspaceModel.isBusy(tab.workspace)
								)
									return;

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

								const neighbor = state.tabs[index + (key === "left" ? -1 : 1)];

								if (!neighbor) return;

								dispatch({ type: "reorder", id: tab.id, overId: neighbor.id });
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
			<Button
				ref={addButton}
				testId="add-workspace"
				aria-label="New workspace"
				tokens={appTokens}
				variant="ghost"
				size="sm"
				focusVisible={focusVisible}
				onMouseDown={onPointerDown}
				onKeyDown={onKeyboardInput}
				style={styles.add}
				onPress={() => {
					if (drag.shouldSuppressClick()) return;

					focusRequested.current = true;
					dispatch({ type: "add" });
				}}
			>
				<WorkspaceTabIcon name="add" testId="add-workspace-icon" />
			</Button>
		</div>
	);
}

import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState, type Dispatch } from "react";

import { appTokens } from "../../styles/tokens";
import { workspaceLayout as layout } from "../../styles/workspace-layout";
import { WorkspaceTab } from "./workspace-tab";
import { WorkspaceTabIcon } from "./workspace-tab-icon";
import { useWorkspaceTabDrag } from "./use-workspace-tab-drag";
import {
	WorkspaceTabsModel,
	type WorkspaceTabsAction,
	type WorkspaceTabsState,
} from "./workspace-tabs-model";

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
	tabs: {
		display: "flex",
		flexDirection: "row",
		alignItems: "end",
		minWidth: 0,
		flexGrow: 1,
		flexBasis: 0,
		flexShrink: 1,
		height: layout.toolbarHeight,
		overflowX: "scroll",
		overflowY: "hidden",
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
}: {
	state: WorkspaceTabsState;
	dispatch: Dispatch<WorkspaceTabsAction>;
}) {
	const renderer = useGpuixRequired();
	const tabs = useRef(new Map<string, PublicInstance>());
	const strip = useRef<PublicInstance>(null);
	const addButton = useRef<PublicInstance>(null);
	const focusRequested = useRef(false);
	const [focusVisible, setFocusVisible] = useState(true);
	const drag = useWorkspaceTabDrag(state, dispatch, strip);
	const { draggingId } = drag;
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
		const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
		if (draggingId) return;
		if (!strip.current || index < 0) return;
		const viewport = renderer.getElementBounds?.(strip.current.id);
		if (!viewport) return;
		const offset = renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0;
		const left = index * layout.tabWidth;
		// GPUIX 0.10 scrollIntoView can leave a new horizontal tab offscreen.
		// Known fixed-width slots let us reveal the entire tab, including its close control.
		const nextOffset = Math.max(
			0,
			left + layout.tabWidth - viewport.width,
			Math.min(left, -offset)
		);
		renderer.scrollTo?.(strip.current.id, -nextOffset, 0);
	}, [renderer, state, draggingId]);

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
				{drag.tabs.map((tab) => (
					<WorkspaceTab
						key={tab.id}
						tab={tab}
						active={state.activeId === tab.id}
						focusVisible={focusVisible}
						onPointerDown={onPointerDown}
						dragging={drag.draggingId === tab.id}
						onTabMouseDown={(event) => {
							onPointerDown();
							drag.onMouseDown(tab.id, event);
							if (event.button === 0) focusTab(tab.id);
						}}
						onTabMouseMove={drag.onMouseMove}
						onTabMouseUp={drag.onMouseUp}
						onCancelDrag={() => drag.cancel(tab.id)}
						onKeyboardInput={onKeyboardInput}
						tabRef={(instance) => {
							if (instance) tabs.current.set(tab.id, instance);
							else tabs.current.delete(tab.id);
						}}
						onActivate={() => {
							if (drag.shouldSuppressClick()) return;
							dispatch({ type: "activate", id: tab.id });
							focusTab(tab.id);
						}}
						onClose={() => {
							if (drag.shouldSuppressClick()) return;
							focusRequested.current = true;
							dispatch({ type: "close", id: tab.id });
						}}
						onNavigate={(key) => {
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
							drag.cancel();
							const index = state.tabs.findIndex((item) => item.id === tab.id);
							const neighbor = state.tabs[index + (key === "left" ? -1 : 1)];
							if (!neighbor) return;
							dispatch({ type: "reorder", id: tab.id, overId: neighbor.id });
							focusTab(tab.id);
						}}
					/>
				))}
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

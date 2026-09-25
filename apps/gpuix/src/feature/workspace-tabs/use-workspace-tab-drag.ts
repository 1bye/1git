import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import {
	useEffect,
	useCallback,
	useRef,
	useState,
	type Dispatch,
	type RefObject,
} from "react";

import { workspaceLayout as layout } from "../../styles/workspace-layout";
import {
	WorkspaceTabsModel,
	type WorkspaceTabsAction,
	type WorkspaceTabsState,
} from "./workspace-tabs-model";

const dragThreshold = 5;
const scrollEdge = 28;
const scrollStep = 10;
const scrollIntervalMs = 16;

interface TabGesture {
	id: string;
	startX: number;
	x: number;
	startScroll: number;
	started: boolean;
	overId: string;
}

/** Owns one captured tab gesture. Preview order commits on release; Escape discards it. */
export function useWorkspaceTabDrag(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	strip: RefObject<PublicInstance | null>
) {
	const renderer = useGpuixRequired();
	const gesture = useRef<TabGesture | null>(null);
	const suppressClick = useRef(false);
	const [preview, setPreview] = useState<{ id: string; overId: string } | null>(
		null
	);
	const scrollOffset = useCallback(
		(): number =>
			strip.current
				? -(renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0)
				: 0,
		[renderer, strip]
	);
	const cancel = (id?: string): void => {
		if (id && gesture.current?.id !== id) return;
		if (gesture.current?.started) suppressClick.current = true;
		gesture.current = null;
		setPreview(null);
	};
	const update = useCallback(
		(x: number): void => {
			const current = gesture.current;
			if (!current) return;
			current.x = x;
			if (!current.started && Math.abs(x - current.startX) < dragThreshold)
				return;
			if (!current.started) dispatch({ type: "activate", id: current.id });
			current.started = true;
			suppressClick.current = true;
			const from = state.tabs.findIndex((tab) => tab.id === current.id);
			const distance =
				x - current.startX + scrollOffset() - current.startScroll;
			const index = Math.max(
				0,
				Math.min(
					state.tabs.length - 1,
					Math.round(from + distance / layout.tabWidth)
				)
			);
			const overId = state.tabs[index]?.id;
			if (!overId) return;
			current.overId = overId;
			setPreview((previous) =>
				previous?.id === current.id && previous.overId === overId
					? previous
					: { id: current.id, overId }
			);
		},
		[dispatch, scrollOffset, state.tabs]
	);
	const scrollAtEdge = useCallback(() => {
		const current = gesture.current;
		const node = strip.current;
		if (!current?.started || !node) return;
		const viewport = renderer.getElementBounds?.(node.id);
		if (!viewport) return;
		const left = layout.desktopTitlebarControlsWidth;
		let delta = 0;
		if (current.x < left + scrollEdge) delta = -scrollStep;
		else if (current.x > left + viewport.width - scrollEdge) delta = scrollStep;
		if (!delta) return;
		const next = Math.max(
			0,
			Math.min(
				state.tabs.length * layout.tabWidth - viewport.width,
				scrollOffset() + delta
			)
		);
		renderer.scrollTo?.(node.id, -next, 0);
		update(current.x);
	}, [renderer, scrollOffset, state.tabs.length, strip, update]);
	const draggingId = preview?.id ?? null;
	useEffect(() => {
		if (!draggingId) return;
		const timer = setInterval(scrollAtEdge, scrollIntervalMs);
		return () => clearInterval(timer);
	}, [draggingId, scrollAtEdge]);

	return {
		draggingId,
		tabs: preview
			? WorkspaceTabsModel.reduce(state, { type: "reorder", ...preview }).tabs
			: state.tabs,
		resetInput: (): void => {
			suppressClick.current = false;
		},
		shouldSuppressClick: (): boolean => suppressClick.current,
		cancel,
		onMouseDown(id: string, event: EventPayload): void {
			suppressClick.current = false;
			if (event.button !== 0 || event.x === undefined) return;
			gesture.current = {
				id,
				startX: event.x,
				x: event.x,
				startScroll: scrollOffset(),
				started: false,
				overId: id,
			};
		},
		onMouseMove(event: EventPayload): void {
			if (event.pressedButton !== 0) {
				cancel();
				return;
			}
			if (event.x !== undefined) update(event.x);
		},
		onMouseUp(event: EventPayload): void {
			if (event.button !== 0) return;
			const current = gesture.current;
			if (current?.started)
				dispatch({ type: "reorder", id: current.id, overId: current.overId });
			cancel();
		},
	};
}

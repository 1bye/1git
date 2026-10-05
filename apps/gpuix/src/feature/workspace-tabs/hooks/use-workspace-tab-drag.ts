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

import { workspaceLayout as layout } from "../../../styles/workspace-layout";
import {
	WorkspaceTabsModel,
	type WorkspaceTabsAction,
	type WorkspaceTabsState,
} from "../lib/workspace-tabs-model";

const dragThreshold = 8;
const scrollEdge = 28;
const scrollStep = 10;
const scrollIntervalMs = 16;

interface TabGesture {
	id: string;
	startX: number;
	x: number;
	startScroll: number;
	startLeft: number;
	started: boolean;
	overId: string;
}

/** Owns one captured tab gesture. Preview order commits on release; Escape discards it. */
export function useWorkspaceTabDrag(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	strip: RefObject<PublicInstance | null>,
	rail: RefObject<PublicInstance | null>
) {
	const renderer = useGpuixRequired();
	const gesture = useRef<TabGesture | null>(null);
	const suppressClick = useRef(false);

	const [preview, setPreview] = useState<{
		id: string;
		overId: string;
		left: number;
	} | null>(null);

	const [settlingId, setSettlingId] = useState<string | null>(null);

	const scrollOffset = useCallback(
		(): number =>
			strip.current
				? -(renderer.getScrollOffset?.(strip.current.id)?.[0] ?? 0)
				: 0,
		[renderer, strip]
	);

	const cancel = (id?: string): void => {
		if (id && gesture.current?.id !== id) return;

		const current = gesture.current;

		if (current && (current.started || preview)) {
			if (current.started) suppressClick.current = true;

			setSettlingId(current.id);
		}

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
			const distance =
				x - current.startX + scrollOffset() - current.startScroll;

			const left = Math.max(
				0,
				Math.min(
					(state.tabs.length - 1) * layout.tabWidth,
					current.startLeft + distance
				)
			);

			const index = Math.round(left / layout.tabWidth);
			const overId = state.tabs[index]?.id;

			if (!overId) return;

			current.overId = overId;
			setPreview((previous) =>
				previous?.id === current.id &&
				previous.overId === overId &&
				previous.left === left
					? previous
					: { id: current.id, overId, left }
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

		const left = viewport.x + scrollOffset();
		const visibleWidth = viewport.width - layout.tabSurfaceOutset * 2;
		let delta = 0;

		if (current.x < left + scrollEdge) delta = -scrollStep;
		else if (current.x > left + visibleWidth - scrollEdge) delta = scrollStep;

		if (!delta) return;

		const next = Math.max(
			0,
			Math.min(
				state.tabs.length * layout.tabWidth - visibleWidth,
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
		settlingId,
		left: preview?.left ?? 0,
		tabs: preview
			? WorkspaceTabsModel.reduce(state, { type: "reorder", ...preview }).tabs
			: state.tabs,
		resetInput: (): void => {
			suppressClick.current = false;
			setSettlingId(null);
		},
		onMotionComplete: (id: string): void => {
			setSettlingId((current) => (current === id ? null : current));
		},
		shouldSuppressClick: (): boolean => suppressClick.current,
		cancel,
		onMouseDown(
			id: string,
			event: EventPayload,
			frame: PublicInstance | null
		): void {
			suppressClick.current = false;

			if (event.button !== 0 || event.x === undefined) return;

			const bounds = frame && renderer.getElementBounds?.(frame.id);

			const railBounds =
				rail.current && renderer.getElementBounds?.(rail.current.id);

			if (!bounds || !railBounds) return;

			const startScroll = scrollOffset();

			// Absolute tab positions belong to the rail, not its padded/scrolled viewport.
			const startLeft = bounds.x - railBounds.x;

			gesture.current = {
				id,
				startX: event.x,
				x: event.x,
				startScroll,
				startLeft,
				started: false,
				overId: id,
			};

			// Hold an interrupted animation, but leave ordinary clicks visually untouched.
			if (settlingId === id) setPreview({ id, overId: id, left: startLeft });
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

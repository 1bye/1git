import { useEffect, useRef, useState, type RefObject } from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import type { UiTokens } from "./tokens";

type Metrics = {
	offset: number;
	maximum: number;
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Optional native-range scrollbars; disabled views create no observers or overlays. */
export function Scrollbars({
	vertical,
	horizontal,
	tokens,
	testId = "scrollbar",
}: {
	vertical: RefObject<PublicInstance | null>;
	horizontal?: RefObject<PublicInstance | null>;
	tokens: UiTokens;
	testId?: string;
}) {
	if (!tokens.showScrollbars) return null;

	return (
		<>
			<Scrollbar
				target={vertical}
				horizontal={false}
				tokens={tokens}
				testId={`${testId}-vertical`}
			/>
			{horizontal ? (
				<Scrollbar
					target={horizontal}
					horizontal
					tokens={tokens}
					testId={`${testId}-horizontal`}
				/>
			) : null}
		</>
	);
}

function Scrollbar({
	target,
	horizontal,
	tokens,
	testId,
}: {
	target: RefObject<PublicInstance | null>;
	horizontal: boolean;
	tokens: UiTokens;
	testId: string;
}) {
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [dragging, setDragging] = useState(false);
	const drag = useRef<{ pointer: number; offset: number } | null>(null);

	useEffect(() => {
		const read = () => {
			const query: unknown = Reflect.get(renderer, "getScrollMetrics");
			const id = target.current?.id;

			if (id === undefined || typeof query !== "function") return;

			const values: unknown = Reflect.apply(query, renderer, [id, horizontal]);

			const valid =
				Array.isArray(values) &&
				values.length === 6 &&
				values.every(
					(value): value is number =>
						typeof value === "number" && Number.isFinite(value)
				);

			const next = valid
				? {
						offset: values[0]!,
						maximum: values[1]!,
						x: values[2]!,
						y: values[3]!,
						width: values[4]!,
						height: values[5]!,
					}
				: null;

			setMetrics((previous) =>
				JSON.stringify(previous) === JSON.stringify(next) ? previous : next
			);
		};

		read();
		const timer = setInterval(read, 50);

		return () => clearInterval(timer);
	}, [renderer, target, horizontal]);

	if (
		!metrics ||
		metrics.maximum <= 0 ||
		metrics.width <= 0 ||
		metrics.height <= 0
	)
		return null;

	const length = Math.max(
		1,
		(horizontal ? metrics.width : metrics.height) - 10
	);

	const viewport = horizontal ? metrics.width : metrics.height;

	const thumb = Math.min(
		length,
		Math.max(24, (length * viewport) / (viewport + metrics.maximum))
	);

	const travel = length - thumb;
	const position = (-metrics.offset / metrics.maximum) * travel;
	const left = horizontal ? metrics.x : metrics.x + metrics.width - 10;
	const top = horizontal ? metrics.y + metrics.height - 10 : metrics.y;

	const scroll = (offset: number) => {
		const id = target.current?.id;

		if (id === undefined) return;

		const current = renderer.getScrollOffset?.(id) ?? [0, 0];
		const next = Math.max(-metrics.maximum, Math.min(0, offset));

		renderer.scrollTo?.(
			id,
			horizontal ? next : (current[0] ?? 0),
			horizontal ? (current[1] ?? 0) : next
		);
		setMetrics({ ...metrics, offset: next });
	};

	const coordinate = (event: EventPayload) =>
		horizontal ? (event.x ?? left) : (event.y ?? top);

	const finish = () => {
		drag.current = null;
		setDragging(false);
	};

	const move = (event: EventPayload) => {
		if (drag.current && travel > 0)
			scroll(
				drag.current.offset -
					((coordinate(event) - drag.current.pointer) / travel) *
						metrics.maximum
			);
	};

	return (
		<>
			<anchored
				position={{ x: left, y: top }}
				anchor="topLeft"
				snapMargin={0}
				deferred
				priority={2}
				style={{ backgroundColor: "rgba(0, 0, 0, 0.001)" }}
			>
				<div
					testId={testId}
					role="scrollbar"
					aria-label={horizontal ? "Horizontal scroll" : "Vertical scroll"}
					aria-orientation={horizontal ? "horizontal" : "vertical"}
					aria-valuemin={0}
					aria-valuemax={metrics.maximum}
					aria-valuenow={-metrics.offset}
					tabIndex={0}
					onMouseDown={(event) => {
						if (event.button !== undefined && event.button !== 0) return;

						const pointer = coordinate(event);
						const local = pointer - (horizontal ? left : top);

						const offset =
							local >= position && local <= position + thumb
								? metrics.offset
								: (-(local - thumb / 2) / Math.max(1, travel)) *
									metrics.maximum;

						scroll(offset);
						drag.current = {
							pointer,
							offset: Math.max(-metrics.maximum, Math.min(0, offset)),
						};
						setDragging(true);
					}}
					onMouseMove={move}
					onMouseUp={finish}
					onKeyDown={(event) => {
						if (event.key === "home") scroll(0);
						else if (event.key === "end") scroll(-metrics.maximum);
						else if (event.key === "pagedown")
							scroll(metrics.offset - viewport);
						else if (event.key === "pageup") scroll(metrics.offset + viewport);
						else if (event.key === (horizontal ? "right" : "down"))
							scroll(metrics.offset - 40);
						else if (event.key === (horizontal ? "left" : "up"))
							scroll(metrics.offset + 40);
					}}
					style={{
						width: horizontal ? length : 10,
						height: horizontal ? 10 : length,
						borderRadius: 5,
						backgroundColor: tokens.colors.surface,
						cursor: "default",
					}}
				>
					<div
						aria-hidden
						style={{
							position: "absolute",
							left: horizontal ? position : 2,
							top: horizontal ? 2 : position,
							width: horizontal ? thumb : 6,
							height: horizontal ? 6 : thumb,
							borderRadius: 3,
							backgroundColor: tokens.colors.textMuted,
							pointerEvents: "none",
						}}
					/>
				</div>
			</anchored>
			{dragging ? (
				<anchored
					position={{ x: 0, y: 0 }}
					anchor="topLeft"
					snapMargin={0}
					deferred
					priority={4}
					style={{ backgroundColor: "rgba(0, 0, 0, 0.001)" }}
				>
					<div
						testId={`${testId}-drag`}
						onMouseMove={move}
						onMouseUp={finish}
						onKeyDown={(event) => {
							if (event.key === "escape") finish();
						}}
						style={{ width: window.width, height: window.height }}
					/>
				</anchored>
			) : null}
		</>
	);
}

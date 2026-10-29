import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useRef, useState, type RefObject } from "react";
import { useAppTheme } from "../../styles/theme";

const dividerHeight = 9;
const minimumRatio = 0.2;
const maximumRatio = 0.75;
const resizeStep = 0.05;

/** Captured graph/detail resizing keeps both panes reachable by mouse and keyboard. */
export function GraphDetailsDivider({
	container,
	ratio,
	onChange,
}: {
	container: RefObject<PublicInstance | null>;
	ratio: number;
	onChange: (ratio: number) => void;
}) {
	const renderer = useGpuixRequired();
	const { colors } = useAppTheme();
	const divider = useRef<PublicInstance>(null);

	const gesture = useRef<{ y: number; ratio: number; height: number } | null>(
		null
	);

	const [focused, setFocused] = useState(false);
	const [pointerFocus, setPointerFocus] = useState(false);

	const resize = (value: number): void =>
		onChange(Math.max(minimumRatio, Math.min(maximumRatio, value)));

	const cancel = (): void => {
		const start = gesture.current;

		gesture.current = null;

		if (start) resize(start.ratio);
	};

	const update = (event: EventPayload): void => {
		const start = gesture.current;

		if (start && event.y !== undefined)
			resize(start.ratio + (event.y - start.y) / start.height);
	};

	return (
		<div
			ref={divider}
			testId="graph-details-divider"
			role="separator"
			aria-label="Resize graph and commit details"
			aria-description="Drag or use Up and Down to resize. Home and End set the limits. Escape cancels a drag."
			aria-orientation="horizontal"
			aria-valuemin={minimumRatio * 100}
			aria-valuemax={maximumRatio * 100}
			aria-valuenow={Math.round(ratio * 100)}
			aria-valuetext={`${Math.round(ratio * 100)}% for the graph`}
			tabIndex={0}
			style={{
				height: dividerHeight,
				flexShrink: 0,
				cursor: "row-resize",
				display: "flex",
				alignItems: "center",
				hover: { backgroundColor: colors.editorSunken },
			}}
			onFocus={() => setFocused(true)}
			onBlur={() => {
				cancel();
				setFocused(false);
				setPointerFocus(false);
			}}
			onMouseDown={(event) => {
				if (event.button !== 0 || event.y === undefined) return;

				const box =
					container.current &&
					renderer.getElementBounds?.(container.current.id);

				if (!box || box.height <= dividerHeight) return;

				setPointerFocus(true);

				if (divider.current) renderer.focusElement?.(divider.current.id);

				gesture.current = {
					y: event.y,
					ratio,
					height: box.height - dividerHeight,
				};
			}}
			onMouseMove={(event) => {
				if (event.pressedButton !== 0) cancel();
				else update(event);
			}}
			onMouseUp={(event) => {
				if (event.button !== 0) return;

				update(event);
				gesture.current = null;
			}}
			onKeyDown={(event) => {
				setPointerFocus(false);

				if (event.key === "escape") {
					cancel();

					return;
				}

				if (
					gesture.current ||
					event.modifiers?.cmd ||
					event.modifiers?.ctrl ||
					event.modifiers?.alt ||
					event.modifiers?.shift
				)
					return;

				if (event.key === "up") resize(ratio - resizeStep);
				else if (event.key === "down") resize(ratio + resizeStep);
				else if (event.key === "home") resize(minimumRatio);
				else if (event.key === "end") resize(maximumRatio);
			}}
		>
			<div
				style={{
					width: "100%",
					height: 1,
					pointerEvents: "none",
					backgroundColor:
						focused && !pointerFocus ? colors.brand : colors.editorHairline,
				}}
			/>
		</div>
	);
}

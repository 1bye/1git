import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useRef, useState, type ReactNode } from "react";
import { useAppTheme } from "../styles/theme";

const resizeStep = 10;

/** Native sidebar with captured dragging, keyboard resizing and a window-bounded width. */
export function ResizableSidebar({
	testId,
	label,
	width,
	onWidthChange,
	minWidth,
	maxWidth,
	hidden = false,
	children,
}: {
	testId: string;
	label: string;
	width: number;
	onWidthChange?: (width: number) => void;
	minWidth: number;
	maxWidth: number;
	hidden?: boolean;
	children: ReactNode;
}) {
	const { colors } = useAppTheme();
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const divider = useRef<PublicInstance>(null);
	const gesture = useRef<{ x: number; width: number } | null>(null);
	const [localWidth, setLocalWidth] = useState(width);
	const [focused, setFocused] = useState(false);
	const [pointerFocus, setPointerFocus] = useState(false);
	const maximum = Math.max(minWidth, Math.min(maxWidth, window.width / 2));

	const clamp = (value: number): number =>
		Math.min(maximum, Math.max(minWidth, value));

	const currentWidth = clamp(onWidthChange ? width : localWidth);

	const resize = (value: number): void =>
		(onWidthChange ?? setLocalWidth)(clamp(value));

	const cancel = (): void => {
		const start = gesture.current;

		gesture.current = null;

		if (start) resize(start.width);
	};

	const update = (event: EventPayload): void => {
		const start = gesture.current;

		if (start && event.x !== undefined) resize(start.width + event.x - start.x);
	};

	return (
		<div
			testId={testId}
			role="navigation"
			aria-label={label}
			aria-hidden={hidden || undefined}
			style={{
				position: hidden ? "absolute" : "relative",
				display: "flex",
				flexDirection: "column",
				width: hidden ? 0 : currentWidth,
				flexShrink: 0,
				minWidth: 0,
				minHeight: 0,
				// Native scrollbars paint above siblings; reserve the divider's hit area.
				paddingRight: 6,
				borderRightWidth: 1,
				borderColor:
					focused && !pointerFocus ? colors.brand : colors.editorHairline,
				...(hidden
					? {
							top: 0,
							bottom: 0,
							left: 0,
							visibility: "hidden",
							pointerEvents: "none",
						}
					: {}),
			}}
		>
			{children}
			<div
				ref={divider}
				testId={`${testId}-divider`}
				role="separator"
				aria-label={`Resize ${label.toLowerCase()}`}
				aria-description="Drag or use Left and Right to resize. Home and End set the limits. Escape cancels a drag."
				aria-orientation="vertical"
				aria-valuemin={minWidth}
				aria-valuemax={maximum}
				aria-valuenow={currentWidth}
				aria-valuetext={`${Math.round(currentWidth)} pixels`}
				tabIndex={hidden ? -1 : 0}
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					right: 0,
					width: 6,
					cursor: "col-resize",
					display: "flex",
					alignItems: "flex-end",
					hover: { backgroundColor: colors.editorSunken },
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					cancel();
					setFocused(false);
					setPointerFocus(false);
				}}
				onMouseDown={(event) => {
					if (event.button !== 0 || event.x === undefined) return;

					setPointerFocus(true);

					if (divider.current) renderer.focusElement?.(divider.current.id);

					gesture.current = { x: event.x, width: currentWidth };
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

					if (event.key === "left") resize(currentWidth - resizeStep);
					else if (event.key === "right") resize(currentWidth + resizeStep);
					else if (event.key === "home") resize(minWidth);
					else if (event.key === "end") resize(maximum);
				}}
			/>
		</div>
	);
}

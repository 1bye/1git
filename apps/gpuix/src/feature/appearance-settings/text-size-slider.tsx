import { useRef, useState } from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useAppTheme } from "../../styles/theme";
import { textSizeRange } from "./app-typography";

const thumbSize = 16;

/** Live point-size adjustment with pointer dragging and native keyboard focus. */
export function TextSizeSlider({
	value,
	onChange,
	width = 280,
}: {
	value: number;
	width?: number;
	onChange?: (value: number) => void;
}) {
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const { tokens } = useAppTheme();
	const target = useRef<PublicInstance>(null);

	const gesture = useRef<{ x: number; width: number; start: number } | null>(
		null
	);

	const [dragging, setDragging] = useState(false);
	const [focused, setFocused] = useState(false);

	const ratio =
		(value - textSizeRange.min) / (textSizeRange.max - textSizeRange.min);

	const change = (next: number): void => {
		const size = Math.max(
			textSizeRange.min,
			Math.min(textSizeRange.max, Math.round(next))
		);

		if (size !== value) onChange?.(size);
	};

	const finish = (): void => {
		gesture.current = null;
		setDragging(false);
	};

	const move = (event: EventPayload): void => {
		const current = gesture.current;

		if (!current || event.x === undefined) return;

		if (event.pressedButton !== 0) {
			finish();

			return;
		}

		change(
			textSizeRange.min +
				((event.x - current.x - thumbSize / 2) / (current.width - thumbSize)) *
					(textSizeRange.max - textSizeRange.min)
		);
	};

	const keyboard = (event: EventPayload): void => {
		if (event.key === "escape" && gesture.current) {
			onChange?.(gesture.current.start);
			finish();

			return;
		}

		if (
			!onChange ||
			gesture.current ||
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt
		)
			return;

		if (event.key === "left" || event.key === "down") change(value - 1);
		else if (event.key === "right" || event.key === "up") change(value + 1);
		else if (event.key === "home") change(textSizeRange.min);
		else if (event.key === "end") change(textSizeRange.max);
	};

	return (
		<>
			<div
				ref={target}
				testId="appearance-font-size"
				role="slider"
				aria-label="Text font size"
				aria-valuemin={textSizeRange.min}
				aria-valuemax={textSizeRange.max}
				aria-valuenow={value}
				aria-valuetext={`${value} points`}
				aria-orientation="horizontal"
				aria-disabled={!onChange}
				tabIndex={onChange ? 0 : -1}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					finish();
				}}
				onKeyDown={keyboard}
				onMouseDown={(event) => {
					if (!onChange || event.button !== 0 || !target.current) return;

					const bounds = renderer.getElementBounds?.(target.current.id);

					if (!bounds) return;

					renderer.focusElement?.(target.current.id);
					gesture.current = { x: bounds.x, width: bounds.width, start: value };
					setDragging(true);
					move({ ...event, pressedButton: 0 });
				}}
				onMouseMove={move}
				onMouseUp={finish}
				style={{
					width,
					height: 28,
					position: "relative",
					flexShrink: 0,
					userSelect: "none",
					borderWidth: 1,
					borderRadius: 6,
					borderColor: focused ? tokens.colors.focusRing : "transparent",
					opacity: onChange ? 1 : 0.45,
				}}
			>
				<div
					style={{
						position: "absolute",
						left: thumbSize / 2,
						top: 12,
						width: width - thumbSize,
						height: 4,
						borderRadius: 2,
						backgroundColor: tokens.colors.border,
						pointerEvents: "none",
					}}
				/>
				<div
					style={{
						position: "absolute",
						left: thumbSize / 2,
						top: 12,
						width: ratio * (width - thumbSize),
						height: 4,
						borderRadius: 2,
						backgroundColor: tokens.colors.accent,
						pointerEvents: "none",
					}}
				/>
				<div
					style={{
						position: "absolute",
						left: ratio * (width - thumbSize),
						top: 6,
						width: thumbSize,
						height: thumbSize,
						borderRadius: thumbSize / 2,
						backgroundColor: tokens.colors.accent,
						pointerEvents: "none",
					}}
				/>
			</div>
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
						testId="appearance-font-size-drag"
						onMouseMove={move}
						onMouseUp={finish}
						onKeyDown={keyboard}
						style={{ width: window.width, height: window.height }}
					/>
				</anchored>
			) : null}
		</>
	);
}

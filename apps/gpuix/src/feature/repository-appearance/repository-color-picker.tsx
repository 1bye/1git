import {
	useEffect,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type ImgInstance,
	type PublicInstance,
} from "@gpuix/react";
import { radius, spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { ColorWheel, type WheelColor } from "./color-wheel";
import { repositoryAppearanceCancel } from "./repository-appearance-shortcut";

const defaultWheelSize = 192;
const imageSize = defaultWheelSize * 2;
const thumbSize = 16;
const defaultWidth = defaultWheelSize + spacing[4] + 80;

function ColorThumb({
	color,
	left,
	top,
}: {
	color: string;
	left: number;
	top: number;
}) {
	return (
		<div
			aria-hidden
			style={{
				position: "absolute",
				width: thumbSize,
				height: thumbSize,
				left,
				top,
				borderRadius: radius.full,
				backgroundColor: "#00000099",
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 1,
					left: 1,
					width: thumbSize - 2,
					height: thumbSize - 2,
					borderWidth: 2,
					borderColor: "#ffffff",
					borderRadius: radius.full,
					backgroundColor: color,
					pointerEvents: "none",
				}}
			/>
		</div>
	);
}

function ColorChannel({
	label,
	value,
	maximum,
	onChange,
	disabled,
}: {
	label: string;
	value: number;
	maximum: number;
	onChange: (value: number) => void;
	disabled: boolean;
}) {
	const { tokens } = useAppTheme();
	const rounded = Math.round(value);

	const [field, setField] = useState({
		source: rounded,
		text: String(rounded),
	});

	if (field.source !== rounded)
		setField({ source: rounded, text: String(rounded) });

	const apply = (): void => {
		const next = Number(field.text);

		if (
			!disabled &&
			field.text.trim() &&
			Number.isFinite(next) &&
			next !== rounded
		)
			onChange(Math.max(0, Math.min(maximum, next)));

		setField({ source: rounded, text: String(rounded) });
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[1],
				width: 80,
				flexShrink: 1,
				minWidth: 0,
			}}
		>
			<text style={{ ...typography.xs, color: tokens.colors.textMuted }}>
				{label}
			</text>
			<input
				testId={`repository-color-${label.toLowerCase()}`}
				aria-label={label}
				aria-description={`Enter a number from 0 to ${maximum}.`}
				value={field.text}
				readOnly={disabled}
				tabIndex={disabled ? -1 : 0}
				onChange={(event) =>
					setField({ source: rounded, text: event.value ?? "" })
				}
				onSubmit={apply}
				onBlur={apply}
				style={{
					...typography.sm,
					height: tokens.layout.controlHeight,
					paddingLeft: spacing[2],
					color: tokens.colors.text,
					backgroundColor: tokens.colors.field,
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.md,
				}}
			/>
		</div>
	);
}

/** Native HSV disc. Drag previews are transient; release and keyboard edits commit once. */
export function RepositoryColorPicker({
	value,
	onPreview,
	onCommit,
	disabled = false,
}: {
	value: string;
	onPreview: (color: string | undefined) => void;
	onCommit: (color: string) => void;
	disabled?: boolean;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const container = useRef<PublicInstance>(null);
	const [availableWidth, setAvailableWidth] = useState(defaultWidth);
	const wheelSize = Math.min(defaultWheelSize, availableWidth);
	const sliderWidth = Math.min(defaultWidth, availableWidth);
	const stacked = availableWidth < defaultWidth;
	const image = useRef<ImgInstance>(null);
	const wheel = useRef<PublicInstance>(null);
	const slider = useRef<PublicInstance>(null);
	const pixels = useMemo(() => ColorWheel.pixels(imageSize), []);

	useLayoutEffect(() => {
		const bounds =
			container.current && renderer.getElementBounds?.(container.current.id);

		if (bounds && bounds.width > 0) setAvailableWidth(bounds.width);
	}, [renderer, window.width]);

	const [selection, setSelection] = useState({
		source: value,
		color: ColorWheel.fromHex(value),
	});

	const [focused, setFocused] = useState<"wheel" | "brightness">();
	const [dragging, setDragging] = useState(false);

	const gesture = useRef<{
		kind: "wheel" | "brightness";
		bounds: { x: number; y: number; width: number; height: number };
		start: WheelColor;
		color: WheelColor;
	} | null>(null);

	if (selection.source !== value)
		setSelection({
			source: value,
			// Keep hue and saturation when a committed black/gray has no unique HSV value.
			color:
				ColorWheel.hex(selection.color) === value
					? selection.color
					: ColorWheel.fromHex(value, selection.color.hue),
		});

	useLayoutEffect(() => {
		if (image.current)
			image.current.setImagePixels(imageSize, imageSize, pixels);
	}, [renderer, pixels]);

	const color = selection.color;
	const radians = (color.hue * Math.PI) / 180;
	const cursorRadius = wheelSize / 2 - 1;

	const commit = (next: WheelColor): void => {
		setSelection({ source: value, color: next });
		onPreview(undefined);
		onCommit(ColorWheel.hex(next));
	};

	const cancel = useCallback((): void => {
		const current = gesture.current;

		if (!current) return;

		gesture.current = null;
		setDragging(false);
		setSelection({ source: value, color: current.start });
		onPreview(undefined);
	}, [onPreview, value]);

	const update = (event: EventPayload): void => {
		const current = gesture.current;

		if (!current || event.x === undefined || event.y === undefined) return;

		const { bounds } = current;

		const next =
			current.kind === "wheel"
				? ColorWheel.atPoint(
						(event.x - bounds.x - bounds.width / 2) / cursorRadius,
						(event.y - bounds.y - bounds.height / 2) / cursorRadius,
						current.color.brightness
					)
				: {
						...current.color,
						brightness: ColorWheel.clamp(
							(event.x - bounds.x - thumbSize / 2) / (bounds.width - thumbSize)
						),
					};

		current.color = next;
		setSelection({ source: value, color: next });
		onPreview(ColorWheel.hex(next));
	};

	const start = (kind: "wheel" | "brightness", event: EventPayload): void => {
		if (disabled || event.button !== 0) return;

		const node = kind === "wheel" ? wheel.current : slider.current;
		const bounds = node && renderer.getElementBounds?.(node.id);

		if (!bounds) return;

		renderer.focusElement?.(node.id);
		gesture.current = { kind, bounds, start: color, color };
		setDragging(true);
		update(event);
	};

	const finish = (event: EventPayload): void => {
		if (event.button !== 0 || !gesture.current) return;

		update(event);
		const next = gesture.current.color;

		gesture.current = null;
		setDragging(false);
		commit(next);
	};

	const move = (event: EventPayload): void => {
		if (event.pressedButton === 0) update(event);
		else cancel();
	};

	const cancelDrag = useRef(cancel);

	cancelDrag.current = cancel;

	useEffect(() => {
		if (!dragging) return;

		const previousCancel = repositoryAppearanceCancel.get(renderer);
		const cancelActiveDrag = () => cancelDrag.current();

		repositoryAppearanceCancel.set(renderer, cancelActiveDrag);

		// Native programmatic focus changes do not always emit blur on a div.
		const timer = setInterval(() => {
			const current = gesture.current;
			const target = current?.kind === "wheel" ? wheel.current : slider.current;

			if (target && renderer.getFocusedElementId?.() !== target.id)
				cancelDrag.current();
		}, 32);

		return () => {
			clearInterval(timer);

			// Native target and window key events arrive separately for the same Escape.
			queueMicrotask(() => {
				if (repositoryAppearanceCancel.get(renderer) !== cancelActiveDrag)
					return;

				if (previousCancel)
					repositoryAppearanceCancel.set(renderer, previousCancel);
				else repositoryAppearanceCancel.delete(renderer);
			});
		};
	}, [dragging, renderer]);

	return (
		<div
			ref={container}
			testId="repository-color-picker"
			aria-disabled={disabled}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[3],
				width: "100%",
				maxWidth: defaultWidth,
				minWidth: 0,
				opacity: disabled ? 0.5 : 1,
				// Native selection otherwise arms on diff text behind the floating picker.
				userSelect: "none",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: spacing[4],
				}}
			>
				<div
					ref={wheel}
					testId="repository-color-wheel"
					role="group"
					aria-label="Color wheel"
					aria-description="Click or drag to choose a color. Left and Right change hue; Up and Down change saturation. Escape cancels a drag. Hue, Saturation and Brightness fields allow exact values."
					aria-valuetext={`Hue ${Math.round(color.hue)} degrees, saturation ${Math.round(color.saturation * 100)} percent`}
					tabIndex={disabled ? -1 : 0}
					onFocus={() => setFocused("wheel")}
					onBlur={() => {
						setFocused(undefined);
						cancel();
					}}
					onMouseDown={(event) => start("wheel", event)}
					onMouseMove={move}
					onMouseUp={finish}
					onKeyDown={(event) => {
						if (event.key === "escape") {
							cancel();

							return;
						}

						if (
							disabled ||
							gesture.current ||
							event.modifiers?.cmd ||
							event.modifiers?.ctrl ||
							event.modifiers?.alt
						)
							return;

						const step = event.modifiers?.shift ? 10 : 1;

						if (event.key === "left" || event.key === "right")
							commit({
								...color,
								hue:
									(color.hue + (event.key === "right" ? step : -step) + 360) %
									360,
							});
						else if (event.key === "up" || event.key === "down")
							commit({
								...color,
								saturation: ColorWheel.clamp(
									color.saturation + (event.key === "up" ? step : -step) / 100
								),
							});
					}}
					style={{
						display: "flex",
						flexDirection: "column",
						position: "relative",
						width: wheelSize,
						height: wheelSize,
						flexShrink: 0,
						borderRadius: radius.full,
						cursor: "crosshair",
					}}
				>
					{focused === "wheel" ? (
						<div
							aria-hidden
							style={{
								position: "absolute",
								top: -4,
								left: -4,
								width: wheelSize + 8,
								height: wheelSize + 8,
								borderRadius: radius.full,
								borderWidth: 2,
								borderColor: tokens.colors.focusRing,
								pointerEvents: "none",
							}}
						/>
					) : null}
					<img
						ref={image}
						alt=""
						aria-hidden
						style={{
							width: wheelSize,
							height: wheelSize,
							pointerEvents: "none",
						}}
					/>
					<div
						aria-hidden
						style={{
							display: "flex",
							flexDirection: "column",
							position: "absolute",
							top: 1,
							left: 1,
							width: wheelSize - 2,
							height: wheelSize - 2,
							borderRadius: radius.full,
							backgroundColor: "#000000",
							opacity: 1 - color.brightness,
							pointerEvents: "none",
						}}
					/>
					<ColorThumb
						color={ColorWheel.hex(color)}
						left={
							wheelSize / 2 +
							Math.cos(radians) * color.saturation * cursorRadius -
							thumbSize / 2
						}
						top={
							wheelSize / 2 -
							Math.sin(radians) * color.saturation * cursorRadius -
							thumbSize / 2
						}
					/>
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: stacked ? "row" : "column",
						flexWrap: "wrap",
						width: stacked ? "100%" : 80,
						gap: spacing[2],
					}}
				>
					<ColorChannel
						disabled={disabled}
						label="Hue"
						value={color.hue}
						maximum={360}
						onChange={(hue) => commit({ ...color, hue })}
					/>
					<ColorChannel
						disabled={disabled}
						label="Saturation"
						value={color.saturation * 100}
						maximum={100}
						onChange={(saturation) =>
							commit({ ...color, saturation: saturation / 100 })
						}
					/>
					<ColorChannel
						disabled={disabled}
						label="Brightness"
						value={color.brightness * 100}
						maximum={100}
						onChange={(brightness) =>
							commit({ ...color, brightness: brightness / 100 })
						}
					/>
				</div>
			</div>
			<div
				ref={slider}
				testId="repository-color-brightness-slider"
				role="slider"
				aria-label="Brightness"
				aria-valuetext={`${Math.round(color.brightness * 100)} percent`}
				aria-description="Left and Right adjust brightness. Home sets black; End sets full brightness."
				tabIndex={disabled ? -1 : 0}
				onFocus={() => setFocused("brightness")}
				onBlur={() => {
					setFocused(undefined);
					cancel();
				}}
				onMouseDown={(event) => start("brightness", event)}
				onMouseMove={move}
				onMouseUp={finish}
				onKeyDown={(event) => {
					if (event.key === "escape") {
						cancel();

						return;
					}

					if (
						disabled ||
						gesture.current ||
						event.modifiers?.cmd ||
						event.modifiers?.ctrl ||
						event.modifiers?.alt
					)
						return;

					const step = event.modifiers?.shift ? 0.1 : 0.01;
					let brightness = color.brightness;

					if (event.key === "left" || event.key === "down") brightness -= step;
					else if (event.key === "right" || event.key === "up")
						brightness += step;
					else if (event.key === "home") brightness = 0;
					else if (event.key === "end") brightness = 1;
					else return;

					commit({ ...color, brightness: ColorWheel.clamp(brightness) });
				}}
				style={{
					display: "flex",
					flexDirection: "column",
					position: "relative",
					width: sliderWidth,
					height: 28,
					justifyContent: "center",
					cursor: "pointer",
					borderRadius: radius.full,
				}}
			>
				{focused === "brightness" ? (
					<div
						aria-hidden
						style={{
							position: "absolute",
							top: -2,
							left: -2,
							width: sliderWidth + 4,
							height: 32,
							borderRadius: radius.full,
							borderWidth: 2,
							borderColor: tokens.colors.focusRing,
							pointerEvents: "none",
						}}
					/>
				) : null}
				<div
					aria-hidden
					style={{
						display: "flex",
						flexDirection: "column",
						height: 12,
						marginLeft: thumbSize / 2,
						marginRight: thumbSize / 2,
						borderRadius: radius.full,
						pointerEvents: "none",
						background: {
							type: "linear-gradient",
							angle: 90,
							stops: [
								{ color: "#000000", position: 0 },
								{
									color: ColorWheel.hex({ ...color, brightness: 1 }),
									position: 1,
								},
							],
						},
					}}
				/>
				<ColorThumb
					color={ColorWheel.hex(color)}
					left={color.brightness * (sliderWidth - thumbSize)}
					top={6}
				/>
			</div>
			{dragging ? (
				<anchored
					position={{ x: 0, y: 0 }}
					anchor="topLeft"
					snapMargin={0}
					deferred
					priority={4}
					// GPUIX otherwise gives the anchored wrapper an opaque default fill.
					style={{ backgroundColor: "rgba(0, 0, 0, 0.001)" }}
				>
					<div
						testId="repository-color-drag"
						onMouseMove={move}
						onMouseUp={finish}
						onKeyDown={(event) => {
							if (event.key === "escape") cancel();
						}}
						style={{
							display: "flex",
							flexDirection: "column",
							width: window.width,
							height: window.height,
							cursor: "crosshair",
						}}
					/>
				</anchored>
			) : null}
		</div>
	);
}

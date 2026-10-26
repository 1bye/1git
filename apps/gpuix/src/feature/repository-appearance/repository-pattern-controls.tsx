import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import {
	defaultPatternAdjustments,
	type RepositoryPatternAdjustments,
} from "./repository-patterns";

const sliderWidth = 304;
const thumbSize = 14;

const percentage = (value: number): number =>
	Math.round(Math.max(0, Math.min(100, value)));

function PatternSlider({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description: string;
	value: number;
	onChange: (value: number) => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const slider = useRef<PublicInstance>(null);
	const gesture = useRef<{ x: number; width: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const [focused, setFocused] = useState(false);

	const stop = useCallback(() => {
		gesture.current = null;
		setDragging(false);
	}, []);

	const update = (event: EventPayload): void => {
		const bounds = gesture.current;

		if (!bounds || event.x === undefined) return;

		onChange(
			percentage(
				((event.x - bounds.x - thumbSize / 2) / (bounds.width - thumbSize)) *
					100
			)
		);
	};

	const move = (event: EventPayload): void => {
		if (event.pressedButton === 0) update(event);
		else stop();
	};

	const finish = (event: EventPayload): void => {
		if (event.button !== 0 || !gesture.current) return;

		update(event);
		stop();
	};

	useEffect(() => {
		if (!dragging) return;

		const timer = setInterval(() => {
			if (
				slider.current &&
				renderer.getFocusedElementId?.() !== slider.current.id
			)
				stop();
		}, 32);

		return () => clearInterval(timer);
	}, [dragging, renderer, stop]);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "space-between",
				}}
			>
				<text style={{ ...typography.sm, color: tokens.colors.text }}>
					{label}
				</text>
				<text
					testId={`repository-pattern-${label.toLowerCase()}-value`}
					style={{ ...typography.xs, color: tokens.colors.textMuted }}
				>
					{`${value}%`}
				</text>
			</div>
			<div
				ref={slider}
				testId={`repository-pattern-${label.toLowerCase()}`}
				role="slider"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={value}
				aria-valuetext={`${value} percent`}
				aria-description={`${description} Arrow keys adjust by one percent; Shift adjusts by ten. Home and End set the limits.`}
				tabIndex={0}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					stop();
				}}
				onMouseDown={(event) => {
					if (event.button !== 0 || !slider.current) return;

					const bounds = renderer.getElementBounds?.(slider.current.id);

					if (!bounds) return;

					renderer.focusElement?.(slider.current.id);
					gesture.current = bounds;
					setDragging(true);
					update(event);
				}}
				onMouseMove={move}
				onMouseUp={finish}
				onKeyDown={(event) => {
					if (
						event.modifiers?.cmd ||
						event.modifiers?.ctrl ||
						event.modifiers?.alt
					)
						return;

					const step = event.modifiers?.shift ? 10 : 1;

					if (event.key === "left" || event.key === "down")
						onChange(percentage(value - step));
					else if (event.key === "right" || event.key === "up")
						onChange(percentage(value + step));
					else if (event.key === "home") onChange(0);
					else if (event.key === "end") onChange(100);
				}}
				style={{
					position: "relative",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					width: "100%",
					maxWidth: sliderWidth,
					height: 24,
					borderRadius: radius.full,
					borderWidth: focused ? 1 : 0,
					borderColor: tokens.colors.focusRing,
					cursor: "pointer",
				}}
			>
				<div
					aria-hidden
					style={{
						height: 5,
						marginLeft: thumbSize / 2,
						marginRight: thumbSize / 2,
						borderRadius: radius.full,
						backgroundColor: tokens.colors.border,
						pointerEvents: "none",
					}}
				>
					<div
						style={{
							width: `${value}%`,
							height: 5,
							backgroundColor: tokens.colors.focusRing,
							borderRadius: radius.full,
							pointerEvents: "none",
						}}
					/>
				</div>
				<div
					aria-hidden
					style={{
						position: "absolute",
						top: 5,
						left: 0,
						right: 0,
						display: "flex",
						flexDirection: "row",
						pointerEvents: "none",
					}}
				>
					<div style={{ flexGrow: value, flexBasis: 0 }} />
					<div
						style={{
							width: thumbSize,
							height: thumbSize,
							flexShrink: 0,
							borderRadius: radius.full,
							backgroundColor: tokens.colors.focusRing,
							borderWidth: 2,
							borderColor: tokens.colors.overlay,
							pointerEvents: "none",
						}}
					/>
					<div style={{ flexGrow: 100 - value, flexBasis: 0 }} />
				</div>
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
						testId="repository-pattern-drag"
						onMouseMove={move}
						onMouseUp={finish}
						style={{
							width: window.width,
							height: window.height,
							cursor: "ew-resize",
						}}
					/>
				</anchored>
			) : null}
		</div>
	);
}

/** Live composition controls; opening the section scrolls it into view above the fixed Done button. */
export function RepositoryPatternControls({
	value,
	disabled,
	onChange,
	scrollContainer,
}: {
	value: RepositoryPatternAdjustments;
	disabled: boolean;
	onChange: (adjustments: RepositoryPatternAdjustments) => void;
	scrollContainer: RefObject<PublicInstance | null>;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		if (!expanded) return;

		const timer = setTimeout(() => {
			if (scrollContainer.current)
				renderer.scrollTo?.(scrollContainer.current.id, 0, -10000);
		}, 0);

		return () => clearTimeout(timer);
	}, [expanded, renderer, scrollContainer]);

	return (
		<div
			testId="repository-pattern-adjustments"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				flexShrink: 0,
			}}
		>
			<Button
				testId="repository-pattern-adjust"
				tokens={tokens}
				variant="secondary"
				aria-label="Adjust pattern"
				aria-expanded={expanded && !disabled}
				disabled={disabled}
				onPress={() => setExpanded(!expanded)}
				style={{
					width: "100%",
					maxWidth: sliderWidth,
					height: 40,
					justifyContent: "space-between",
					paddingLeft: spacing[3],
					paddingRight: spacing[3],
					borderColor: tokens.colors.border,
					borderRadius: radius.lg,
				}}
			>
				<text style={{ ...typography.sm, color: tokens.colors.textControl }}>
					Adjust pattern
				</text>
				<WorkspaceTabIcon
					name={expanded && !disabled ? "caretDown" : "caretRight"}
					color={tokens.colors.textControl}
					size={16}
				/>
			</Button>
			{expanded && !disabled ? (
				<div
					testId="repository-pattern-adjustment-controls"
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[3],
						width: "100%",
						maxWidth: sliderWidth,
						flexShrink: 0,
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[2],
						}}
					>
						<text style={{ ...typography.sm, color: tokens.colors.text }}>
							Layout
						</text>
						<div
							role="group"
							aria-label="Pattern layout"
							style={{
								display: "flex",
								flexDirection: "row",
								flexWrap: "wrap",
								gap: spacing[1],
							}}
						>
							{(["scattered", "clusters", "hero"] as const).map((layout) => (
								<Button
									key={layout}
									testId={`repository-pattern-layout-${layout}`}
									tokens={tokens}
									size="sm"
									variant={value.layout === layout ? "secondary" : "ghost"}
									aria-pressed={value.layout === layout}
									aria-description={
										value.layout === layout ? "Selected" : undefined
									}
									onPress={() => onChange({ ...value, layout })}
									style={{ flexGrow: 1, flexBasis: 80, minWidth: 0 }}
								>
									{`${layout[0]?.toUpperCase()}${layout.slice(1)}`}
								</Button>
							))}
						</div>
					</div>
					<PatternSlider
						label="Density"
						description="Fewer symbols to more symbols."
						value={value.density}
						onChange={(density) => onChange({ ...value, density })}
					/>
					<PatternSlider
						label="Size"
						description="Small symbols to large symbols."
						value={value.size}
						onChange={(size) => onChange({ ...value, size })}
					/>
					<PatternSlider
						label="Strength"
						description="Faint background detail to prominent artwork."
						value={value.strength}
						onChange={(strength) => onChange({ ...value, strength })}
					/>
					<PatternSlider
						label="Variation"
						description="Uniform sizes and angles to an irregular arrangement."
						value={value.variation}
						onChange={(variation) => onChange({ ...value, variation })}
					/>
					<Button
						testId="repository-pattern-adjustments-reset"
						tokens={tokens}
						variant="ghost"
						size="sm"
						onPress={() => onChange(defaultPatternAdjustments)}
						style={{ alignSelf: "flex-start", paddingLeft: 0 }}
					>
						Reset adjustments
					</Button>
				</div>
			) : null}
		</div>
	);
}

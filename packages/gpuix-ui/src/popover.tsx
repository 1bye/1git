import { radius, spacing } from "@1git/design-tokens";
import {
	createContext,
	use,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";
import {
	AnimatePresence,
	motion,
	useGpuixRequired,
	useWindowSize,
	useIsPresent,
	type NativeRenderer,
	type PublicInstance,
	type WindowKeyEventHandler,
} from "@gpuix/react";
import { setRefs } from "@gpuix/react/floating";
import { Button, type ButtonProps } from "./button";
import { defaultTokens, type UiTokens } from "./tokens";

type PopoverState = {
	open: boolean;
	modal: boolean;
	setOpen: (open: boolean) => void;
	anchor: RefObject<PublicInstance | null>;
	trigger: RefObject<ReactElement<ButtonProps> | null>;
	setTrigger: (trigger: ReactElement<ButtonProps>) => void;
};
const Context = createContext<PopoverState | null>(null);

function usePopover() {
	const state = use(Context);

	if (!state) throw new Error("Popover components require a Popover parent.");

	return state;
}

// Per-renderer lifetime: removed when the floating surface unmounts, including exit animation.
const keyHandlers = new WeakMap<NativeRenderer, WindowKeyEventHandler[]>();

/** Call before normal window shortcuts/traversal. Returns true while a modal popover owns keyboard input. */
export function handlePopoverKeyDown(
	...args: Parameters<WindowKeyEventHandler>
): boolean {
	const handler = keyHandlers.get(args[1])?.at(-1);

	if (!handler) return false;

	handler(...args);

	return true;
}

/** Controlled anchored surface. Its trigger and content share focus and open state; Git/domain state stays with callers. */
export function Popover({
	open,
	onOpenChange,
	modal = true,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	modal?: boolean;
	children: ReactNode;
}) {
	const anchor = useRef<PublicInstance>(null);
	const trigger = useRef<ReactElement<ButtonProps> | null>(null);

	return (
		<Context
			value={{
				open,
				setOpen: onOpenChange,
				modal,
				anchor,
				trigger,
				setTrigger: (element) => {
					trigger.current = element;
				},
			}}
		>
			{children}
		</Context>
	);
}

/** A Button-compatible trigger. asChild preserves the supplied Button's appearance and onPress handler. */
export function PopoverTrigger({
	asChild = false,
	children,
	...props
}: ButtonProps & { asChild?: boolean }) {
	const state = usePopover();

	if (asChild && !isValidElement<ButtonProps>(children))
		throw new Error(
			"PopoverTrigger asChild requires one Button-compatible element."
		);

	const child =
		asChild && isValidElement<ButtonProps>(children) ? (
			children
		) : (
			<Button {...props}>{children}</Button>
		);

	const element = cloneElement(child, {
		...props,
		ref: (node: PublicInstance | null) =>
			setRefs(node, state.anchor, child.props.ref, props.ref),
		"aria-expanded": state.open,
		onPress: () => {
			child.props.onPress?.();
			state.setOpen(!state.open);
		},
	});

	useLayoutEffect(() => {
		state.setTrigger(element);
	});

	return element;
}

/** Styled, viewport-clamped dialog. Dismissal can be blocked while a caller performs a write. */
export interface PopoverContentProps {
	children: ReactNode;
	"aria-label": string;
	side?: "top" | "bottom";
	/** Centered dialogs do not require a trigger; anchored surfaces retain their current placement. */
	placement?: "anchored" | "center";
	align?: "start" | "center" | "end";
	width?: number;
	dismissible?: boolean;
	tokens?: UiTokens;
	testId?: string;
}

/** Retains the native floating layer through its exit animation, then restores trigger focus. */
export function PopoverContent(props: PopoverContentProps) {
	const state = usePopover();
	const renderer = useGpuixRequired();
	const previousFocus = useRef<number | undefined>(undefined);

	useLayoutEffect(() => {
		if (state.open)
			previousFocus.current = renderer.getFocusedElementId?.() ?? undefined;
	}, [state.open, renderer]);

	return (
		<AnimatePresence
			onExitComplete={() => {
				if (state.anchor.current)
					renderer.focusElement?.(state.anchor.current.id);
				else if (previousFocus.current !== undefined)
					renderer.focusElement?.(previousFocus.current);
			}}
		>
			{state.open ? <PopoverSurface key="surface" {...props} /> : null}
		</AnimatePresence>
	);
}

function PopoverSurface({
	children,
	side = "top",
	placement = "anchored",
	align = "end",
	width = 300,
	dismissible = true,
	tokens = defaultTokens,
	testId = "popover-content",
	"aria-label": label,
}: PopoverContentProps) {
	const state = usePopover();
	const present = useIsPresent();
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const dialog = useRef<PublicInstance>(null);
	const body = useRef<PublicInstance>(null);
	const latest = useRef({ state, dismissible });

	latest.current = { state, dismissible };
	const [geometry, setGeometry] = useState({
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		contentHeight: 220,
	});

	const centered = placement === "center";
	const ready = centered || geometry.width > 0;
	const inset = 12;
	const gap = 8;
	const panelWidth = Math.max(1, Math.min(width, window.width - inset * 2));
	const above = geometry.y - inset - gap;
	const below = window.height - geometry.y - geometry.height - inset - gap;

	const top =
		side === "top"
			? above >= geometry.contentHeight || above >= below
			: !(below >= geometry.contentHeight || below >= above);

	const availableHeight = centered
		? window.height - inset * 2
		: top
			? above
			: below;

	const height = Math.min(geometry.contentHeight, Math.max(1, availableHeight));

	const left = centered
		? (window.width - panelWidth) / 2
		: Math.max(
				inset,
				Math.min(
					geometry.x +
						(align === "end"
							? geometry.width - panelWidth
							: align === "center"
								? (geometry.width - panelWidth) / 2
								: 0),
					window.width - inset - panelWidth
				)
			);

	const y = centered
		? Math.max(inset, (window.height - height) / 2)
		: Math.max(
				inset,
				top ? geometry.y - gap - height : geometry.y + geometry.height + gap
			);

	const dismiss = () => {
		if (latest.current.dismissible) latest.current.state.setOpen(false);
	};

	useLayoutEffect(() => {
		const measure = () => {
			const anchor =
				state.anchor.current &&
				renderer.getElementBounds?.(state.anchor.current.id);

			const content =
				body.current && renderer.getElementBounds?.(body.current.id);

			if (!anchor && !centered) return;

			setGeometry((previous) => {
				const next = {
					...(anchor ?? { x: 0, y: 0, width: panelWidth, height: 0 }),
					contentHeight: content?.height || previous.contentHeight,
				};

				return Object.keys(previous).every(
					(key) =>
						previous[key as keyof typeof previous] ===
						next[key as keyof typeof next]
				)
					? previous
					: next;
			});
		};

		measure();
		const interval = setInterval(measure, 100);

		return () => clearInterval(interval);
	}, [renderer, state.anchor, centered, panelWidth]);

	useEffect(() => {
		if (!ready || !dialog.current) return;

		renderer.focusElement?.(dialog.current.id);
		renderer.focusNextWithin?.(dialog.current.id);
	}, [ready, renderer]);

	useEffect(() => {
		if (!state.modal) return;

		const handler: WindowKeyEventHandler = (event) => {
			if (event.key === "escape") dismiss();

			if (event.key === "tab" && dialog.current) {
				if (event.modifiers?.shift) {
					const before = renderer.getFocusedElementId?.();

					renderer.focusPreviousWithin?.(dialog.current.id);

					// GPUIX 0.10 can stop at the first scoped field instead of wrapping backwards.
					if (before != null && renderer.getFocusedElementId?.() === before) {
						const visited = new Set<number>([before]);
						let previous = before;

						for (;;) {
							renderer.focusNextWithin?.(dialog.current.id);
							const next = renderer.getFocusedElementId?.();

							if (next == null || visited.has(next)) break;

							visited.add(next);
							previous = next;
						}

						renderer.focusElement?.(previous);
					}
				} else renderer.focusNextWithin?.(dialog.current.id);
			}
		};

		const handlers = keyHandlers.get(renderer) ?? [];

		handlers.push(handler);
		keyHandlers.set(renderer, handlers);

		return () => {
			const index = handlers.indexOf(handler);

			if (index >= 0) handlers.splice(index, 1);

			if (!handlers.length) keyHandlers.delete(renderer);
		};
	}, [renderer, state.modal]);

	const trigger = state.trigger.current;

	return (
		<anchored
			position={{ x: 0, y: 0 }}
			anchor="topLeft"
			snapMargin={0}
			deferred
			priority={3}
			occlude
			// GPUIX substitutes opaque black for a fully transparent anchored fill.
			style={{
				position: "absolute",
				width: window.width,
				height: window.height,
				backgroundColor: "rgba(0, 0, 0, 0.001)",
			}}
		>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: ready ? 1 : 0 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.16, ease: "easeOut" }}
				style={{
					width: "100%",
					height: "100%",
					backgroundColor: "transparent",
					pointerEvents: present ? "auto" : "none",
				}}
			>
				<div
					testId="popover-backdrop"
					onClick={dismiss}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						height: "100%",
						backgroundColor: state.modal
							? "rgba(0, 0, 0, 0.28)"
							: "transparent",
					}}
				/>
				<div
					ref={dialog}
					testId={testId}
					role="dialog"
					aria-label={label}
					tabIndex={-1}
					style={{
						position: "absolute",
						left,
						top: y,
						width: panelWidth,
						maxHeight: Math.max(1, availableHeight),
						overflowY: "scroll",
						borderRadius: radius["2xl"],
						backgroundColor: tokens.colors.overlay,
						boxShadow: {
							offsetX: 0,
							offsetY: 8,
							blurRadius: 24,
							spreadRadius: 0,
							color: tokens.colors.shadow,
						},
					}}
				>
					<div
						ref={body}
						style={{ padding: spacing[2], gap: spacing[2], flexShrink: 0 }}
						onKeyDown={(event) => {
							if (!state.modal && event.key === "escape") dismiss();
						}}
					>
						{children}
					</div>
				</div>
				{trigger && ready ? (
					<div
						style={{
							position: "absolute",
							left: geometry.x,
							top: geometry.y,
							width: geometry.width,
							height: geometry.height,
							backgroundColor: tokens.colors.overlay,
							borderRadius: radius.md,
						}}
					>
						{cloneElement(trigger, {
							ref: null,
							testId: "popover-raised-trigger",
							tabIndex: -1,
							onPress: dismiss,
						})}
					</div>
				) : null}
			</motion.div>
		</anchored>
	);
}

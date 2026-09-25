import {
	Combobox,
	ComboboxPopup,
	type ComboboxPopupProps,
	ComboboxPortal,
	ComboboxPositioner,
	type ComboboxPositionerProps,
	type ComboboxRootProps,
	ComboboxTrigger,
} from "@1git/ui/components/combobox";
import {
	ContextMenu,
	ContextMenuTrigger,
} from "@1git/ui/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@1git/ui/components/dropdown-menu";
import {
	createMenuOutsidePressEventDetails,
	createOutsidePressEventDetails,
} from "@1git/ui/lib/base-ui-event-details";
import { cn } from "@1git/ui/lib/utils";
import type {
	ComponentProps,
	CSSProperties,
	ReactElement,
	Ref,
	RefCallback,
} from "react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { LiquidMenuSurface } from "@/fixture/liquid-menu/components/liquid-menu-surface.js";
import {
	getLiquidMenuStyle,
	LIQUID_MENU_GEOMETRY,
	LIQUID_MENU_MOTION,
	LIQUID_SUBMENU_CLOSE_DELAY_MS,
	type LiquidMenuGeometry,
	type LiquidMenuMotion,
} from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	LiquidMenuContext,
	type LiquidMenuContextValue,
	LiquidMenuSubContext,
	type LiquidMenuSubContextValue,
	useLiquidMenuContext,
	useLiquidMenuSubContext,
} from "@/fixture/liquid-menu/hooks/use-liquid-menu-context.js";
import { useLiquidMenuStack } from "@/fixture/liquid-menu/hooks/use-liquid-menu-stack.js";
import type { LiquidMenuAnchorGeometry } from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import { getLiquidMenuLayerZIndices } from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";

type DropdownMenuProps = ComponentProps<typeof DropdownMenu>;
type DropdownMenuOpenChange = NonNullable<DropdownMenuProps["onOpenChange"]>;
type ContextMenuProps = ComponentProps<typeof ContextMenu>;
type ContextMenuOpenChange = NonNullable<ContextMenuProps["onOpenChange"]>;
type ComboboxOpenChange<
	Value,
	Multiple extends boolean | undefined = false,
> = NonNullable<ComboboxRootProps<Value, Multiple>["onOpenChange"]>;

interface LiquidRootSurfaceProps {
	readonly anchor?: () => Element | null;
	readonly anchorClip?: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly geometry?: Partial<LiquidMenuGeometry>;
	readonly motion?: Partial<LiquidMenuMotion>;
	readonly onPresenceChange?: (isPresent: boolean) => void;
	readonly outlineWidth?: number;
}

export interface LiquidMenuRootProps
	extends Omit<DropdownMenuProps, "onOpenChange">, LiquidRootSurfaceProps {
	readonly onOpenChange?: DropdownMenuOpenChange;
}

export interface LiquidContextMenuRootProps
	extends Omit<ContextMenuProps, "onOpenChange">, LiquidRootSurfaceProps {
	readonly onOpenChange?: ContextMenuOpenChange;
}

export interface LiquidPickerRootProps<
	Value,
	Multiple extends boolean | undefined = false,
>
	extends
		Omit<ComboboxRootProps<Value, Multiple>, "onOpenChange">,
		LiquidRootSurfaceProps {
	readonly onOpenChange?: ComboboxOpenChange<Value, Multiple>;
}

interface LiquidPickerContentProps extends ComboboxPopupProps {
	readonly align?: ComboboxPositionerProps["align"];
	readonly alignOffset?: ComboboxPositionerProps["alignOffset"];
	readonly anchor?: ComboboxPositionerProps["anchor"];
	readonly positionerClassName?: string;
	readonly positionerStyle?: CSSProperties;
	readonly side?: ComboboxPositionerProps["side"];
	readonly sideOffset?: ComboboxPositionerProps["sideOffset"];
}

interface UseLiquidMenuRootOptions {
	readonly anchor: (() => Element | null) | undefined;
	readonly anchorClip: (() => Element | null) | undefined;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly defaultOpen?: boolean;
	readonly geometry: Partial<LiquidMenuGeometry> | undefined;
	readonly motion: Partial<LiquidMenuMotion> | undefined;
	readonly onPresenceChange?: (isPresent: boolean) => void;
	readonly open?: boolean;
	readonly outlineWidth: number;
}

interface LiquidMenuRootState {
	readonly changeOpen: (isOpen: boolean) => void;
	readonly context: LiquidMenuContextValue;
	readonly isOpen: boolean;
}

type LiquidTriggerState = "closing" | "idle" | "open";

const assignRef = <ElementType,>(
	ref: Ref<ElementType> | undefined,
	value: ElementType | null
): void => {
	if (typeof ref === "function") {
		ref(value);

		return;
	}

	if (ref) {
		ref.current = value;
	}
};

const useMergedElementRef = <ElementType extends HTMLElement>(
	firstRef: Ref<ElementType> | undefined,
	secondRef: RefCallback<HTMLElement>
): RefCallback<ElementType> =>
	useCallback(
		(element: ElementType | null): void => {
			assignRef(firstRef, element);
			secondRef(element);
		},
		[firstRef, secondRef]
	);

const useLiquidMenuRoot = ({
	anchor,
	anchorClip,
	anchorGeometry,
	defaultOpen,
	geometry,
	motion,
	onPresenceChange,
	open,
	outlineWidth,
}: UseLiquidMenuRootOptions): LiquidMenuRootState => {
	const layerId = useId();
	const stack = useLiquidMenuStack();
	const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
	const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
	const activeSubmenuIdRef = useRef<string | null>(null);
	const [hasSurface, setHasSurface] = useState(false);
	const [hasSubmenuSurface, setHasSubmenuSurface] = useState(false);

	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(
		null
	);

	const [menuElement, setMenuElement] = useState<HTMLElement | null>(null);

	const [submenuElement, setSubmenuElement] = useState<HTMLElement | null>(
		null
	);

	const [submenuTriggerElement, setSubmenuTriggerElement] =
		useState<HTMLElement | null>(null);

	const isOpen = open ?? internalOpen;
	const layerIndex = stack.layerIds.indexOf(layerId);

	const isTopLayer =
		layerIndex >= 0 && layerIndex === stack.layerIds.length - 1;

	const readTriggerElement = useCallback(
		(): Element | null => triggerElement,
		[triggerElement]
	);

	const resolvedAnchor = anchor ?? readTriggerElement;

	const resolvedGeometry = useMemo<LiquidMenuGeometry>(
		() => ({ ...LIQUID_MENU_GEOMETRY, ...geometry }),
		[geometry]
	);

	const resolvedMotion = useMemo<LiquidMenuMotion>(
		() => ({ ...LIQUID_MENU_MOTION, ...motion }),
		[motion]
	);

	const changeSubmenuOpen = useCallback(
		(submenuId: string, nextIsOpen: boolean): void => {
			if (nextIsOpen) {
				activeSubmenuIdRef.current = submenuId;
				setActiveSubmenuId(submenuId);
				setSubmenuElement(null);
				setSubmenuTriggerElement(null);

				return;
			}

			if (activeSubmenuIdRef.current === submenuId) {
				activeSubmenuIdRef.current = null;
				setActiveSubmenuId(null);
			}
		},
		[]
	);

	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			if (open === undefined) {
				setInternalOpen(nextIsOpen);
			}

			if (!nextIsOpen) {
				activeSubmenuIdRef.current = null;
				setActiveSubmenuId(null);
			}
		},
		[open]
	);

	const changePresence = useCallback(
		(isPresent: boolean): void => {
			setHasSurface(isPresent);
			onPresenceChange?.(isPresent);
		},
		[onPresenceChange]
	);

	const changeSubmenuPresence = useCallback((isPresent: boolean): void => {
		setHasSubmenuSurface(isPresent);
	}, []);

	useLayoutEffect(() => {
		if (!hasSurface) {
			return;
		}

		stack.showLayer(layerId);

		return () => stack.hideLayer(layerId);
	}, [hasSurface, layerId, stack.hideLayer, stack.showLayer]);

	useLayoutEffect(() => {
		if (hasSurface && isOpen) {
			stack.showLayer(layerId);
		}
	}, [hasSurface, isOpen, layerId, stack.showLayer]);

	const context = useMemo<LiquidMenuContextValue>(
		() => ({
			activeSubmenuId,
			anchor: resolvedAnchor,
			anchorClip,
			anchorGeometry,
			geometry: resolvedGeometry,
			hasSubmenuSurface,
			hasSurface,
			isOpen,
			isSubmenuOpen: activeSubmenuId !== null,
			isTopLayer,
			layerIndex,
			menuElement,
			motion: resolvedMotion,
			onPresenceChange: changePresence,
			onSubmenuOpenChange: changeSubmenuOpen,
			onSubmenuPresenceChange: changeSubmenuPresence,
			outlineWidth,
			setMenuElement,
			setSubmenuElement,
			setSubmenuTriggerElement,
			setTriggerElement,
			submenuElement,
			submenuTriggerElement,
		}),
		[
			activeSubmenuId,
			anchorClip,
			anchorGeometry,
			changePresence,
			changeSubmenuOpen,
			changeSubmenuPresence,
			hasSubmenuSurface,
			hasSurface,
			isOpen,
			isTopLayer,
			layerIndex,
			menuElement,
			outlineWidth,
			resolvedAnchor,
			resolvedGeometry,
			resolvedMotion,
			submenuElement,
			submenuTriggerElement,
		]
	);

	return { changeOpen, context, isOpen };
};

const getLiquidTriggerState = (
	context: LiquidMenuContextValue
): LiquidTriggerState => {
	if (context.isOpen) {
		return "open";
	}

	return context.hasSurface ? "closing" : "idle";
};

export function LiquidMenuRoot({
	anchor,
	anchorClip,
	anchorGeometry,
	defaultOpen,
	geometry,
	motion,
	onOpenChange,
	onPresenceChange,
	open,
	outlineWidth = 1,
	...props
}: LiquidMenuRootProps): ReactElement {
	const state = useLiquidMenuRoot({
		anchor,
		anchorClip,
		anchorGeometry,
		defaultOpen,
		geometry,
		motion,
		onPresenceChange,
		open,
		outlineWidth,
	});

	const changeOpen: DropdownMenuOpenChange = (nextIsOpen, eventDetails) => {
		state.changeOpen(nextIsOpen);
		onOpenChange?.(nextIsOpen, eventDetails);
	};

	const dismissFromBackdrop = (event: PointerEvent): void => {
		changeOpen(false, createMenuOutsidePressEventDetails(event));
	};

	return (
		<LiquidMenuContext value={state.context}>
			<LiquidMenuSurface onBackdropPress={dismissFromBackdrop} />
			<DropdownMenu onOpenChange={changeOpen} open={state.isOpen} {...props} />
		</LiquidMenuContext>
	);
}

export function LiquidContextMenuRoot({
	anchor,
	anchorClip,
	anchorGeometry,
	defaultOpen,
	geometry,
	motion,
	onOpenChange,
	onPresenceChange,
	open,
	outlineWidth = 1,
	...props
}: LiquidContextMenuRootProps): ReactElement {
	const state = useLiquidMenuRoot({
		anchor,
		anchorClip,
		anchorGeometry,
		defaultOpen,
		geometry,
		motion,
		onPresenceChange,
		open,
		outlineWidth,
	});

	const changeOpen: ContextMenuOpenChange = (nextIsOpen, eventDetails) => {
		state.changeOpen(nextIsOpen);
		onOpenChange?.(nextIsOpen, eventDetails);
	};

	const dismissFromBackdrop = (event: PointerEvent): void => {
		changeOpen(false, createOutsidePressEventDetails(event));
	};

	return (
		<LiquidMenuContext value={state.context}>
			<LiquidMenuSurface onBackdropPress={dismissFromBackdrop} />
			<ContextMenu onOpenChange={changeOpen} open={state.isOpen} {...props} />
		</LiquidMenuContext>
	);
}

export function LiquidPickerRoot<
	Value,
	Multiple extends boolean | undefined = false,
>({
	anchor,
	anchorClip,
	anchorGeometry,
	defaultOpen,
	geometry,
	motion,
	onOpenChange,
	onPresenceChange,
	open,
	outlineWidth = 1,
	...props
}: LiquidPickerRootProps<Value, Multiple>): ReactElement {
	const state = useLiquidMenuRoot({
		anchor,
		anchorClip,
		anchorGeometry,
		defaultOpen,
		geometry,
		motion,
		onPresenceChange,
		open,
		outlineWidth,
	});

	const changeOpen: ComboboxOpenChange<Value, Multiple> = (
		nextIsOpen,
		eventDetails
	) => {
		state.changeOpen(nextIsOpen);
		onOpenChange?.(nextIsOpen, eventDetails);
	};

	const dismissFromBackdrop = (event: PointerEvent): void => {
		state.changeOpen(false);
		onOpenChange?.(false, createOutsidePressEventDetails(event));
	};

	return (
		<LiquidMenuContext value={state.context}>
			<LiquidMenuSurface onBackdropPress={dismissFromBackdrop} />
			<Combobox onOpenChange={changeOpen} open={state.isOpen} {...props} />
		</LiquidMenuContext>
	);
}

export function LiquidMenuTrigger({
	ref,
	...props
}: ComponentProps<typeof DropdownMenuTrigger>): ReactElement {
	const context = useLiquidMenuContext();
	const triggerRef = useMergedElementRef(ref, context.setTriggerElement);

	return (
		<DropdownMenuTrigger
			ref={triggerRef}
			{...props}
			data-liquid-state={getLiquidTriggerState(context)}
			data-liquid-trigger=""
		/>
	);
}

export function LiquidPickerTrigger({
	ref,
	...props
}: ComponentProps<typeof ComboboxTrigger>): ReactElement {
	const context = useLiquidMenuContext();
	const triggerRef = useMergedElementRef(ref, context.setTriggerElement);

	return (
		<ComboboxTrigger
			ref={triggerRef}
			{...props}
			data-liquid-state={getLiquidTriggerState(context)}
			data-liquid-trigger=""
		/>
	);
}

export function LiquidContextMenuTrigger({
	ref,
	...props
}: ComponentProps<typeof ContextMenuTrigger>): ReactElement {
	const context = useLiquidMenuContext();
	const triggerRef = useMergedElementRef(ref, context.setTriggerElement);

	return (
		<ContextMenuTrigger
			ref={triggerRef}
			{...props}
			data-liquid-state={getLiquidTriggerState(context)}
			data-liquid-trigger=""
		/>
	);
}

export function LiquidMenuContent({
	anchor,
	className,
	positionerStyle,
	ref,
	style,
	...props
}: ComponentProps<typeof DropdownMenuContent>): ReactElement {
	const context = useLiquidMenuContext();
	const contentRef = useMergedElementRef(ref, context.setMenuElement);

	const { content: contentZIndex } = getLiquidMenuLayerZIndices(
		context.layerIndex
	);

	return (
		<DropdownMenuContent
			{...props}
			anchor={anchor ?? context.anchor}
			className={cn(
				"data-closed:animate-none data-open:animate-none",
				context.hasSurface ? "border-transparent bg-transparent" : "opacity-0",
				className
			)}
			data-liquid-content=""
			data-liquid-surface={context.hasSurface ? "true" : undefined}
			data-name="LiquidMenuContent"
			positionerStyle={{ ...positionerStyle, zIndex: contentZIndex }}
			ref={contentRef}
			style={{ ...getLiquidMenuStyle(context.motion), ...style }}
		/>
	);
}

export function LiquidPickerContent({
	align = "start",
	alignOffset = 0,
	anchor,
	className,
	positionerClassName,
	positionerStyle,
	ref,
	side = "bottom",
	sideOffset = 4,
	style,
	...props
}: LiquidPickerContentProps): ReactElement {
	const context = useLiquidMenuContext();
	const contentRef = useMergedElementRef(ref, context.setMenuElement);

	const { content: contentZIndex } = getLiquidMenuLayerZIndices(
		context.layerIndex
	);

	return (
		<ComboboxPortal>
			<ComboboxPositioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor ?? context.anchor}
				className={positionerClassName}
				side={side}
				sideOffset={sideOffset}
				style={{ ...positionerStyle, zIndex: contentZIndex }}
			>
				<ComboboxPopup
					{...props}
					className={cn(
						"data-closed:animate-none data-open:animate-none",
						context.hasSurface
							? "border-transparent bg-transparent"
							: "opacity-0",
						className
					)}
					data-liquid-content=""
					data-liquid-surface={context.hasSurface ? "true" : undefined}
					data-name="LiquidPickerContent"
					ref={contentRef}
					style={{ ...getLiquidMenuStyle(context.motion), ...style }}
				/>
			</ComboboxPositioner>
		</ComboboxPortal>
	);
}

export function LiquidMenuSub({
	anchor,
	onOpenChange,
	open,
	...props
}: ComponentProps<typeof DropdownMenuSub> & {
	readonly anchor?: HTMLElement | null;
}): ReactElement {
	const context = useLiquidMenuContext();
	const submenuId = useId();
	const [internalOpen, setInternalOpen] = useState(false);

	const [contentElement, setContentElement] = useState<HTMLElement | null>(
		null
	);

	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(
		null
	);

	const isOpen = open ?? internalOpen;

	const changeOpen: NonNullable<
		ComponentProps<typeof DropdownMenuSub>["onOpenChange"]
	> = (nextIsOpen, eventDetails): void => {
		if (open === undefined) {
			setInternalOpen(nextIsOpen);
		}

		onOpenChange?.(nextIsOpen, eventDetails);
	};

	useEffect(() => {
		context.onSubmenuOpenChange(submenuId, isOpen);
	}, [context.onSubmenuOpenChange, isOpen, submenuId]);
	useEffect(() => {
		if (!(isOpen && context.activeSubmenuId === submenuId)) {
			return;
		}

		context.setSubmenuElement(contentElement);
		context.setSubmenuTriggerElement(anchor ?? triggerElement);
	}, [
		anchor,
		contentElement,
		context.activeSubmenuId,
		context.setSubmenuElement,
		context.setSubmenuTriggerElement,
		isOpen,
		submenuId,
		triggerElement,
	]);
	useEffect(
		() => (): void => context.onSubmenuOpenChange(submenuId, false),
		[context.onSubmenuOpenChange, submenuId]
	);

	const submenuContext = useMemo<LiquidMenuSubContextValue>(
		() => ({
			setContentElement,
			setTriggerElement,
		}),
		[]
	);

	return (
		<LiquidMenuSubContext value={submenuContext}>
			<DropdownMenuSub onOpenChange={changeOpen} open={isOpen} {...props} />
		</LiquidMenuSubContext>
	);
}

export function LiquidMenuSubTrigger({
	closeDelay = LIQUID_SUBMENU_CLOSE_DELAY_MS,
	openOnHover = true,
	ref,
	...props
}: ComponentProps<typeof DropdownMenuSubTrigger>): ReactElement {
	const context = useLiquidMenuSubContext();
	const triggerRef = useMergedElementRef(ref, context.setTriggerElement);

	return (
		<DropdownMenuSubTrigger
			closeDelay={closeDelay}
			openOnHover={openOnHover}
			ref={triggerRef}
			{...props}
		/>
	);
}

export function LiquidMenuSubContent({
	className,
	positionerStyle,
	ref,
	side = "right",
	sideOffset = 0,
	style,
	...props
}: ComponentProps<typeof DropdownMenuSubContent>): ReactElement {
	const menuContext = useLiquidMenuContext();
	const submenuContext = useLiquidMenuSubContext();
	const contentRef = useMergedElementRef(ref, submenuContext.setContentElement);

	const { content: contentZIndex } = getLiquidMenuLayerZIndices(
		menuContext.layerIndex
	);

	return (
		<DropdownMenuSubContent
			{...props}
			className={cn(
				"data-closed:animate-none data-open:animate-none",
				menuContext.hasSubmenuSurface
					? "border-transparent bg-transparent"
					: "opacity-0",
				className
			)}
			data-liquid-content=""
			data-liquid-surface={menuContext.hasSubmenuSurface ? "true" : undefined}
			data-name="LiquidMenuSubContent"
			positionerStyle={{ ...positionerStyle, zIndex: contentZIndex }}
			ref={contentRef}
			side={side}
			sideOffset={sideOffset}
			style={{ ...getLiquidMenuStyle(menuContext.motion), ...style }}
		/>
	);
}

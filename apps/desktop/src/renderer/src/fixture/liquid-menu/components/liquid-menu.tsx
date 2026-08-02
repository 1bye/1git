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
import { cn } from "@1git/ui/lib/utils";
import type { ComponentProps, ReactElement, Ref, RefCallback } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { LiquidMenuSurface } from "@/fixture/liquid-menu/components/liquid-menu-surface.js";
import {
	LIQUID_MENU_STYLE,
	LIQUID_SUBMENU_CLOSE_DELAY_MS,
} from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	LiquidMenuContext,
	type LiquidMenuContextValue,
	LiquidMenuSubContext,
	type LiquidMenuSubContextValue,
	useLiquidMenuContext,
	useLiquidMenuSubContext,
} from "@/fixture/liquid-menu/hooks/use-liquid-menu-context.js";
import type { LiquidMenuAnchorGeometry } from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import { getLiquidMenuAnchorPresentation } from "@/fixture/liquid-menu/lib/liquid-menu-layer.js";

type DropdownMenuProps = ComponentProps<typeof DropdownMenu>;
type DropdownMenuOpenChange = NonNullable<DropdownMenuProps["onOpenChange"]>;
type ContextMenuProps = ComponentProps<typeof ContextMenu>;
type ContextMenuOpenChange = NonNullable<ContextMenuProps["onOpenChange"]>;

interface LiquidMenuRootProps extends Omit<DropdownMenuProps, "onOpenChange"> {
	readonly anchor: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly obscured?: boolean;
	readonly onOpenChange?: DropdownMenuOpenChange;
	readonly onPresenceChange?: (isPresent: boolean) => void;
	readonly outlineWidth?: number;
}

interface LiquidContextMenuRootProps
	extends Omit<ContextMenuProps, "onOpenChange"> {
	readonly anchor: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly obscured?: boolean;
	readonly onOpenChange?: ContextMenuOpenChange;
	readonly onPresenceChange?: (isPresent: boolean) => void;
	readonly outlineWidth?: number;
}

interface UseLiquidMenuRootOptions {
	readonly anchor: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly defaultOpen?: boolean;
	readonly obscured: boolean;
	readonly onPresenceChange?: (isPresent: boolean) => void;
	readonly open?: boolean;
	readonly outlineWidth: number;
}

interface LiquidMenuRootState {
	readonly changeOpen: (isOpen: boolean) => void;
	readonly context: LiquidMenuContextValue;
	readonly isOpen: boolean;
}

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
	anchorGeometry,
	defaultOpen,
	obscured,
	onPresenceChange,
	open,
	outlineWidth,
}: UseLiquidMenuRootOptions): LiquidMenuRootState => {
	const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
	const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
	const activeSubmenuIdRef = useRef<string | null>(null);
	const [hasSurface, setHasSurface] = useState(false);
	const [hasSubmenuSurface, setHasSubmenuSurface] = useState(false);
	const [menuElement, setMenuElement] = useState<HTMLElement | null>(null);
	const [submenuElement, setSubmenuElement] = useState<HTMLElement | null>(
		null
	);
	const [submenuTriggerElement, setSubmenuTriggerElement] =
		useState<HTMLElement | null>(null);
	const isOpen = open ?? internalOpen;

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

	const context = useMemo<LiquidMenuContextValue>(
		() => ({
			activeSubmenuId,
			anchor,
			anchorGeometry,
			hasSubmenuSurface,
			hasSurface,
			isObscured: obscured,
			isOpen,
			isSubmenuOpen: activeSubmenuId !== null,
			menuElement,
			onPresenceChange: changePresence,
			onSubmenuOpenChange: changeSubmenuOpen,
			onSubmenuPresenceChange: changeSubmenuPresence,
			outlineWidth,
			setMenuElement,
			setSubmenuElement,
			setSubmenuTriggerElement,
			submenuElement,
			submenuTriggerElement,
		}),
		[
			activeSubmenuId,
			anchor,
			anchorGeometry,
			changePresence,
			changeSubmenuOpen,
			changeSubmenuPresence,
			hasSubmenuSurface,
			hasSurface,
			obscured,
			isOpen,
			menuElement,
			outlineWidth,
			submenuElement,
			submenuTriggerElement,
		]
	);

	return { changeOpen, context, isOpen };
};

export function LiquidMenuRoot({
	anchor,
	anchorGeometry,
	defaultOpen,
	obscured = false,
	onOpenChange,
	onPresenceChange,
	open,
	outlineWidth = 1,
	...props
}: LiquidMenuRootProps): ReactElement {
	const state = useLiquidMenuRoot({
		anchor,
		anchorGeometry,
		defaultOpen,
		obscured,
		onPresenceChange,
		open,
		outlineWidth,
	});
	const changeOpen: DropdownMenuOpenChange = (nextIsOpen, eventDetails) => {
		state.changeOpen(nextIsOpen);
		onOpenChange?.(nextIsOpen, eventDetails);
	};

	return (
		<LiquidMenuContext value={state.context}>
			<LiquidMenuSurface />
			<DropdownMenu onOpenChange={changeOpen} open={state.isOpen} {...props} />
		</LiquidMenuContext>
	);
}

export function LiquidContextMenuRoot({
	anchor,
	anchorGeometry,
	defaultOpen,
	obscured = false,
	onOpenChange,
	onPresenceChange,
	open,
	outlineWidth = 1,
	...props
}: LiquidContextMenuRootProps): ReactElement {
	const state = useLiquidMenuRoot({
		anchor,
		anchorGeometry,
		defaultOpen,
		obscured,
		onPresenceChange,
		open,
		outlineWidth,
	});
	const changeOpen: ContextMenuOpenChange = (nextIsOpen, eventDetails) => {
		state.changeOpen(nextIsOpen);
		onOpenChange?.(nextIsOpen, eventDetails);
	};

	return (
		<LiquidMenuContext value={state.context}>
			<LiquidMenuSurface />
			<ContextMenu onOpenChange={changeOpen} open={state.isOpen} {...props} />
		</LiquidMenuContext>
	);
}

export function LiquidMenuTrigger({
	...props
}: ComponentProps<typeof DropdownMenuTrigger>): ReactElement {
	const context = useLiquidMenuContext();
	const anchorPresentation = getLiquidMenuAnchorPresentation({
		hasSurface: context.hasSurface,
		isObscured: context.isObscured,
		isOpen: context.isOpen,
	});

	return (
		<DropdownMenuTrigger
			data-liquid-menu-anchor-obscured={context.isObscured ? "true" : undefined}
			data-liquid-menu-anchor-promoted={
				anchorPresentation.isPromoted ? "true" : undefined
			}
			data-liquid-menu-anchor-state={
				anchorPresentation.isActive ? "active" : undefined
			}
			{...props}
		/>
	);
}

export function LiquidContextMenuTrigger({
	...props
}: ComponentProps<typeof ContextMenuTrigger>): ReactElement {
	const context = useLiquidMenuContext();
	const anchorPresentation = getLiquidMenuAnchorPresentation({
		hasSurface: context.hasSurface,
		isObscured: context.isObscured,
		isOpen: context.isOpen,
	});

	return (
		<ContextMenuTrigger
			data-liquid-menu-anchor-obscured={context.isObscured ? "true" : undefined}
			data-liquid-menu-anchor-promoted={
				anchorPresentation.isPromoted ? "true" : undefined
			}
			data-liquid-menu-anchor-state={
				anchorPresentation.isActive ? "active" : undefined
			}
			{...props}
		/>
	);
}

export function LiquidMenuContent({
	anchor,
	className,
	ref,
	style,
	...props
}: ComponentProps<typeof DropdownMenuContent>): ReactElement {
	const context = useLiquidMenuContext();
	const contentRef = useMergedElementRef(ref, context.setMenuElement);

	return (
		<DropdownMenuContent
			anchor={anchor ?? context.anchor}
			className={cn(
				"data-closed:animate-none data-open:animate-none",
				context.hasSurface ? "border-transparent bg-transparent" : "opacity-0",
				className
			)}
			data-liquid-menu-obscured={context.isObscured ? "true" : undefined}
			data-liquid-surface={context.hasSurface ? "true" : undefined}
			data-name="LiquidMenuContent"
			ref={contentRef}
			style={{ ...LIQUID_MENU_STYLE, ...style }}
			{...props}
		/>
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
	ref,
	side = "right",
	sideOffset = 0,
	style,
	...props
}: ComponentProps<typeof DropdownMenuSubContent>): ReactElement {
	const menuContext = useLiquidMenuContext();
	const submenuContext = useLiquidMenuSubContext();
	const contentRef = useMergedElementRef(ref, submenuContext.setContentElement);

	return (
		<DropdownMenuSubContent
			className={cn(
				"data-closed:animate-none data-open:animate-none",
				menuContext.hasSubmenuSurface
					? "border-transparent bg-transparent"
					: "opacity-0",
				className
			)}
			data-liquid-surface={menuContext.hasSubmenuSurface ? "true" : undefined}
			data-name="LiquidMenuSubContent"
			ref={contentRef}
			side={side}
			sideOffset={sideOffset}
			style={{ ...LIQUID_MENU_STYLE, ...style }}
			{...props}
		/>
	);
}

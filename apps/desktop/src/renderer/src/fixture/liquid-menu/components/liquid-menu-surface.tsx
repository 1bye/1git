import type { CSSProperties, ReactElement } from "react";
import { LIQUID_MENU_MOTION } from "../constants/liquid-menu.js";
import { useLiquidMenuContext } from "../hooks/use-liquid-menu-context.js";
import { useLiquidMenuSurface } from "../hooks/use-liquid-menu-surface.js";

export function LiquidMenuSurface(): ReactElement | null {
	const {
		anchor,
		anchorGeometry,
		isOpen,
		isSubmenuOpen,
		menuElement,
		onPresenceChange,
		onSubmenuPresenceChange,
		outlineWidth,
		submenuElement,
		submenuTriggerElement,
	} = useLiquidMenuContext();
	const { frame, progress, submenuProgress } = useLiquidMenuSurface({
		anchor,
		anchorGeometry,
		isOpen,
		isSubmenuOpen,
		menuElement,
		onPresenceChange,
		onSubmenuPresenceChange,
		submenuElement,
		submenuTriggerElement,
	});
	if (!frame) {
		return null;
	}

	const backdropStyle: CSSProperties = {
		opacity: LIQUID_MENU_MOTION.backdropOpacity * progress,
	};
	const surfaceStyle: CSSProperties = {
		height: frame.bounds.height,
		left: frame.bounds.left,
		top: frame.bounds.top,
		width: frame.bounds.width,
	};

	return (
		<div
			aria-hidden
			className="pointer-events-none fixed inset-0 z-[3]"
			data-name="LiquidMenuLayer"
			data-progress={progress.toFixed(3)}
			data-submenu-progress={submenuProgress.toFixed(3)}
		>
			<span
				className="absolute inset-0 bg-black"
				data-name="LiquidMenuBackdrop"
				style={backdropStyle}
			/>
			<svg
				aria-hidden
				className="absolute overflow-visible"
				data-name="LiquidMenuSurface"
				preserveAspectRatio="none"
				style={surfaceStyle}
				viewBox={`0 0 ${frame.bounds.width} ${frame.bounds.height}`}
			>
				<title>Menu surface</title>
				<path d={frame.path} data-name="LiquidMenuSurfaceFill" />
				<path
					d={frame.path}
					data-name="LiquidMenuSurfaceOutline"
					fill="none"
					strokeLinejoin="round"
					strokeWidth={outlineWidth}
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		</div>
	);
}

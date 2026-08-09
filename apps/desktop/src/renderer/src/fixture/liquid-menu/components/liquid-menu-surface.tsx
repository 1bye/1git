import type { CSSProperties, ReactElement } from "react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { useLiquidMenuContext } from "@/fixture/liquid-menu/hooks/use-liquid-menu-context.js";
import { useLiquidMenuSurface } from "@/fixture/liquid-menu/hooks/use-liquid-menu-surface.js";
import {
	getLiquidMenuBackdropOpacity,
	getLiquidMenuLayerZIndices,
} from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";

const getSvgMaskUrl = (maskId: string): string => `url(#${maskId})`;

export function LiquidMenuSurface(): ReactElement | null {
	const maskId = useId().replaceAll(":", "");
	const {
		anchor,
		anchorClip,
		anchorGeometry,
		geometry,
		isOpen,
		isSubmenuOpen,
		isTopLayer,
		layerIndex,
		menuElement,
		motion,
		onPresenceChange,
		onSubmenuPresenceChange,
		outlineWidth,
		submenuElement,
		submenuTriggerElement,
	} = useLiquidMenuContext();
	const { frame, progress, submenuProgress } = useLiquidMenuSurface({
		anchor,
		anchorClip,
		anchorGeometry,
		geometry,
		isOpen,
		isSubmenuOpen,
		menuElement,
		motion,
		onPresenceChange,
		onSubmenuPresenceChange,
		submenuElement,
		submenuTriggerElement,
	});
	if (!frame) {
		return null;
	}

	if (layerIndex < 0) {
		return null;
	}

	const backdropMaskId = `${maskId}-backdrop`;
	const surfaceMaskId = `${maskId}-surface`;
	const backdropOpacity = getLiquidMenuBackdropOpacity({
		hasLayerBelow: layerIndex > 0,
		isTopLayer,
		opacity: motion.backdropOpacity,
		progress,
	});
	const { backdrop: backdropZIndex, surface: surfaceZIndex } =
		getLiquidMenuLayerZIndices(layerIndex);
	const backdropLayerStyle: CSSProperties = {
		zIndex: backdropZIndex,
	};
	const surfaceLayerStyle: CSSProperties = {
		zIndex: surfaceZIndex,
	};
	const surfaceStyle: CSSProperties = {
		height: frame.bounds.height,
		left: frame.bounds.left,
		top: frame.bounds.top,
		width: frame.bounds.width,
	};

	return createPortal(
		<>
			{isTopLayer ? (
				<div
					aria-hidden
					className="pointer-events-none fixed inset-0"
					data-layer-index={layerIndex}
					data-name="LiquidMenuBackdropLayer"
					data-progress={progress.toFixed(3)}
					style={backdropLayerStyle}
				>
					<svg
						aria-hidden
						className="absolute inset-0 size-full"
						data-name="LiquidMenuBackdrop"
						preserveAspectRatio="none"
					>
						<title>Dimmed application backdrop</title>
						<defs>
							<mask
								height="100%"
								id={backdropMaskId}
								maskContentUnits="userSpaceOnUse"
								maskUnits="userSpaceOnUse"
								width="100%"
								x="0"
								y="0"
							>
								<rect fill="white" height="100%" width="100%" />
								<path
									d={frame.path}
									fill="black"
									transform={`translate(${frame.bounds.left} ${frame.bounds.top})`}
								/>
							</mask>
						</defs>
						<rect
							className="pointer-events-auto"
							data-desktop-interactive
							data-name="LiquidMenuBackdropFill"
							fill="var(--liquid-dim)"
							height="100%"
							mask={getSvgMaskUrl(backdropMaskId)}
							opacity={backdropOpacity}
							width="100%"
						/>
					</svg>
				</div>
			) : null}
			<div
				aria-hidden
				className="pointer-events-none fixed inset-0"
				data-layer-index={layerIndex}
				data-name="LiquidMenuSurfaceLayer"
				data-progress={progress.toFixed(3)}
				data-submenu-progress={submenuProgress.toFixed(3)}
				style={surfaceLayerStyle}
			>
				<svg
					aria-hidden
					className="absolute overflow-visible"
					data-name="LiquidMenuSurface"
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${frame.bounds.width} ${frame.bounds.height}`}
				>
					<title>Menu surface</title>
					<defs>
						<mask
							height={frame.bounds.height}
							id={surfaceMaskId}
							maskContentUnits="userSpaceOnUse"
							maskUnits="userSpaceOnUse"
							width={frame.bounds.width}
							x="0"
							y="0"
						>
							<rect
								fill="white"
								height={frame.bounds.height}
								width={frame.bounds.width}
							/>
							<rect
								fill="black"
								height={frame.anchor.height}
								rx={frame.anchor.radius}
								width={frame.anchor.width}
								x={frame.anchor.left}
								y={frame.anchor.top}
							/>
						</mask>
					</defs>
					<path
						d={frame.path}
						data-name="LiquidMenuSurfaceFill"
						mask={getSvgMaskUrl(surfaceMaskId)}
					/>
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
		</>,
		document.body
	);
}

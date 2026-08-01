import type { CSSProperties, ReactElement } from "react";
import { WORKSPACE_ACTIONS_LIQUID_MOTION } from "../constants/workspace-actions-menu.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "../constants/workspace-tab.js";
import { useWorkspaceActionsLiquidSurface } from "../hooks/use-workspace-actions-liquid-surface.js";

interface WorkspaceActionsLiquidSurfaceProps {
	readonly isOpen: boolean;
	readonly isSubmenuOpen: boolean;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly onSubmenuPresenceChange: (isPresent: boolean) => void;
}

export function WorkspaceActionsLiquidSurface({
	isOpen,
	isSubmenuOpen,
	onPresenceChange,
	onSubmenuPresenceChange,
}: WorkspaceActionsLiquidSurfaceProps): ReactElement | null {
	const { frame, progress, submenuProgress } = useWorkspaceActionsLiquidSurface(
		{
			isOpen,
			isSubmenuOpen,
			onPresenceChange,
			onSubmenuPresenceChange,
		}
	);
	if (!frame) {
		return null;
	}

	const backdropStyle: CSSProperties = {
		opacity: WORKSPACE_ACTIONS_LIQUID_MOTION.backdropOpacity * progress,
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
			data-name="WorkspaceActionsLiquidLayer"
			data-progress={progress.toFixed(3)}
			data-submenu-progress={submenuProgress.toFixed(3)}
		>
			<span
				className="absolute inset-0 bg-black"
				data-name="WorkspaceActionsBackdrop"
				style={backdropStyle}
			/>
			<svg
				aria-hidden
				className="absolute overflow-visible"
				data-name="WorkspaceActionsLiquidSurface"
				preserveAspectRatio="none"
				style={surfaceStyle}
				viewBox={`0 0 ${frame.bounds.width} ${frame.bounds.height}`}
			>
				<title>Workspace actions surface</title>
				<path d={frame.path} data-name="WorkspaceActionsLiquidSurfaceFill" />
				<path
					d={frame.path}
					data-name="WorkspaceActionsLiquidSurfaceOutline"
					fill="none"
					strokeLinejoin="round"
					strokeWidth={WORKSPACE_TAB_SURFACE_GEOMETRY.outlineWidth}
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		</div>
	);
}

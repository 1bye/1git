import type { CSSProperties, ReactElement } from "react";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { useWorkspaceLiquidSurface } from "@/fixture/desktop-toolbar/hooks/use-workspace-liquid-surface.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface WorkspaceLiquidSurfaceProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly activeTabIndex: number;
	readonly isDragging: boolean;
}

export function WorkspaceLiquidSurface({
	activeSessionId,
	activeTabIndex,
	isDragging,
}: WorkspaceLiquidSurfaceProps): ReactElement {
	const { hostRef, path, surfaceWidth } = useWorkspaceLiquidSurface({
		activeSessionId,
		activeTabIndex,
		isDragging,
	});
	const surfaceStyle: CSSProperties | undefined =
		surfaceWidth === null
			? undefined
			: {
					height:
						WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight +
						WORKSPACE_TAB_SURFACE_GEOMETRY.containerOverlap,
					width: surfaceWidth,
				};

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
			data-name="WorkspaceLiquidSurfaceHost"
			ref={hostRef}
		>
			{path !== "" && surfaceWidth !== null ? (
				<svg
					aria-hidden
					className="absolute top-0 left-0 overflow-hidden"
					data-name="WorkspaceLiquidSurface"
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${surfaceWidth} ${WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight + WORKSPACE_TAB_SURFACE_GEOMETRY.containerOverlap}`}
				>
					<title>Active workspace surface</title>
					<path d={path} data-name="WorkspaceLiquidSurfaceFill" />
					<path
						d={path}
						data-name="WorkspaceLiquidSurfaceOutline"
						fill="none"
						strokeLinejoin="round"
						strokeWidth={WORKSPACE_TAB_SURFACE_GEOMETRY.outlineWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
			) : null}
		</div>
	);
}

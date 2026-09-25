import type { CSSProperties, ReactElement, RefObject } from "react";

import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { useWorkspaceLiquidSurface } from "@/fixture/desktop-toolbar/hooks/use-workspace-liquid-surface.js";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface WorkspaceLiquidSurfaceProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly activeTabIndex: number;
	readonly isPositionTracking: boolean;
	readonly workspaceRootRef: RefObject<HTMLElement | null>;
}

export function WorkspaceLiquidSurface({
	activeSessionId,
	activeTabIndex,
	isPositionTracking,
	workspaceRootRef,
}: WorkspaceLiquidSurfaceProps): ReactElement {
	const { hostRef, path, surfaceWidth } = useWorkspaceLiquidSurface({
		activeSessionId,
		activeTabIndex,
		isPositionTracking,
		workspaceRootRef,
	});
	const surfaceStyle: CSSProperties | undefined =
		surfaceWidth === null
			? undefined
			: {
					height:
						WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight +
						WORKSPACE_TAB_SURFACE_GEOMETRY.containerRenderDepth,
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
					viewBox={`0 0 ${surfaceWidth} ${WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight + WORKSPACE_TAB_SURFACE_GEOMETRY.containerRenderDepth}`}
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

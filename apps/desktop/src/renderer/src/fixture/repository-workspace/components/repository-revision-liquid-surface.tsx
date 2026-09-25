import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { createLiquidGeometryTracker } from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";
import {
	createRepositoryFileLiquidMeasurement,
	createRepositoryFileLiquidPath,
	hasSameRepositoryFileLiquidPathGeometry,
	type RepositoryFileLiquidMeasurement,
	type RepositoryFileLiquidRect,
} from "@/fixture/repository-workspace/lib/repository-file-liquid-geometry.js";

interface RepositoryRevisionLiquidSurfaceProps {
	readonly selectedRevisionKey: string | null;
}

interface RepositoryRevisionLiquidPathCache {
	readonly measurement: RepositoryFileLiquidMeasurement;
	readonly path: string;
}

const REVISION_SURFACE_MOTION_DURATION_MS = 180;
const REVISION_LIST_SELECTOR =
	'[data-repository-revision-navigation-group="revisions"]';
const REVISION_ROW_SELECTOR = '[data-repository-revision-liquid-active="true"]';
const REVISION_SHELF_SELECTOR =
	'[data-repository-context-shelf][data-state="open"]';
const REVISION_VIEWPORT_SELECTOR =
	"[data-repository-revision-navigation-viewport]";

const getRect = (element: Element): RepositoryFileLiquidRect => {
	const bounds = element.getBoundingClientRect();
	return {
		height: bounds.height,
		left: bounds.left,
		top: bounds.top,
		width: bounds.width,
	};
};

const hasSameMeasurement = (
	current: RepositoryFileLiquidMeasurement | null,
	next: RepositoryFileLiquidMeasurement | null
): boolean => {
	if (!(current && next)) {
		return current === next;
	}
	return (
		current.canvasEdgeX === next.canvasEdgeX &&
		current.canvasSide === next.canvasSide &&
		current.clipBottom === next.clipBottom &&
		current.clipTop === next.clipTop &&
		current.rowHeight === next.rowHeight &&
		current.rowLeft === next.rowLeft &&
		current.rowTop === next.rowTop &&
		current.rowWidth === next.rowWidth &&
		current.surfaceHeight === next.surfaceHeight &&
		current.surfaceLeft === next.surfaceLeft &&
		current.surfaceTop === next.surfaceTop &&
		current.surfaceWidth === next.surfaceWidth
	);
};

export function RepositoryRevisionLiquidSurface({
	selectedRevisionKey,
}: RepositoryRevisionLiquidSurfaceProps): ReactElement {
	const clipPathId = useId();
	const hostRef = useRef<HTMLDivElement>(null);
	const pathCacheRef = useRef<RepositoryRevisionLiquidPathCache | null>(null);
	const previousRevisionKeyRef = useRef(selectedRevisionKey);
	const [isMoving, setIsMoving] = useState(false);
	const [measurement, setMeasurement] =
		useState<RepositoryFileLiquidMeasurement | null>(null);

	useLayoutEffect(() => {
		const previousRevisionKey = previousRevisionKeyRef.current;
		previousRevisionKeyRef.current = selectedRevisionKey;
		const shouldMove = Boolean(
			previousRevisionKey &&
			selectedRevisionKey &&
			previousRevisionKey !== selectedRevisionKey
		);
		setIsMoving(shouldMove);
		if (!shouldMove) {
			return;
		}
		const motionTimeout = window.setTimeout(() => {
			setIsMoving(false);
		}, REVISION_SURFACE_MOTION_DURATION_MS);
		return () => {
			window.clearTimeout(motionTimeout);
		};
	}, [selectedRevisionKey]);

	useLayoutEffect(() => {
		const host = hostRef.current;
		const workspace = host?.parentElement;
		const shelf = workspace?.querySelector<HTMLElement>(
			REVISION_SHELF_SELECTOR
		);
		const revisionList = workspace?.querySelector<HTMLElement>(
			REVISION_LIST_SELECTOR
		);
		const viewport = revisionList?.closest<HTMLElement>(
			REVISION_VIEWPORT_SELECTOR
		);
		if (
			!(workspace && shelf && revisionList && viewport && selectedRevisionKey)
		) {
			setMeasurement(null);
			return;
		}

		const measure = (): void => {
			const row = revisionList.querySelector<HTMLElement>(
				REVISION_ROW_SELECTOR
			);
			const nextMeasurement = row
				? createRepositoryFileLiquidMeasurement(
						getRect(workspace),
						getRect(shelf),
						getRect(row),
						getRect(viewport)
					)
				: null;
			setMeasurement((currentMeasurement) =>
				hasSameMeasurement(currentMeasurement, nextMeasurement)
					? currentMeasurement
					: nextMeasurement
			);
		};
		const row = revisionList.querySelector<HTMLElement>(REVISION_ROW_SELECTOR);
		const tracker = createLiquidGeometryTracker(measure);
		tracker.setElements([
			workspace,
			shelf,
			revisionList,
			viewport,
			...(row ? [row] : []),
		]);
		tracker.measureNow();
		return tracker.disconnect;
	}, [selectedRevisionKey]);

	const path = useMemo(() => {
		if (!measurement) {
			return;
		}
		const cachedPath = pathCacheRef.current;
		if (
			cachedPath &&
			hasSameRepositoryFileLiquidPathGeometry(
				cachedPath.measurement,
				measurement
			)
		) {
			return cachedPath.path;
		}
		const nextPath = createRepositoryFileLiquidPath(measurement);
		pathCacheRef.current = { measurement, path: nextPath };
		return nextPath;
	}, [measurement]);
	const surfaceStyle = measurement
		? ({
				height: measurement.surfaceHeight,
				left: measurement.surfaceLeft,
				top: measurement.surfaceTop,
				width: measurement.surfaceWidth,
			} satisfies CSSProperties)
		: undefined;

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-10 overflow-visible"
			data-name="RepositoryRevisionLiquidSurfaceHost"
			ref={hostRef}
		>
			{measurement && path ? (
				<svg
					className="absolute overflow-hidden"
					data-moving={isMoving ? "true" : undefined}
					data-name="RepositoryRevisionLiquidSurface"
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${measurement.surfaceWidth} ${measurement.surfaceHeight}`}
				>
					<title>Active revision liquid surface</title>
					<defs>
						<clipPath id={clipPathId}>
							<rect
								height={
									measurement.surfaceHeight -
									measurement.clipTop -
									measurement.clipBottom
								}
								width={measurement.surfaceWidth}
								x="0"
								y={measurement.clipTop}
							/>
						</clipPath>
					</defs>
					<path
						clipPath={`url(#${clipPathId})`}
						d={path}
						data-name="RepositoryRevisionLiquidSurfaceFill"
					/>
				</svg>
			) : null}
		</div>
	);
}

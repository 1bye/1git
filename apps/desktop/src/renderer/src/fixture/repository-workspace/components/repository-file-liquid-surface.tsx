import type { FileChange } from "@1git/git";
import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createLiquidGeometryTracker } from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";
import {
	createRepositoryFileLiquidMeasurement,
	createRepositoryFileLiquidPath,
	type RepositoryFileLiquidMeasurement,
	type RepositoryFileLiquidRect,
} from "@/fixture/repository-workspace/lib/repository-file-liquid-geometry.js";
import { getRepositoryFileRowId } from "@/fixture/repository-workspace/lib/repository-navigation.js";

interface RepositoryFileLiquidSurfaceProps {
	readonly files?: readonly FileChange[];
	readonly selectedFilePath: string | null;
}

const FILE_SURFACE_MOTION_DURATION_MS = 180;

interface RepositoryFileLiquidSurfaceMeasurement
	extends RepositoryFileLiquidMeasurement {
	readonly hasLeadingOverflow: boolean;
	readonly headerMaskBottom: number;
}

interface RepositoryFileLiquidSurfaceStyle extends CSSProperties {
	readonly "--repository-file-liquid-header-mask-bottom": string;
}

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
	current: RepositoryFileLiquidSurfaceMeasurement | null,
	next: RepositoryFileLiquidSurfaceMeasurement | null
): boolean => {
	if (!(current && next)) {
		return current === next;
	}
	return (
		current.canvasEdgeX === next.canvasEdgeX &&
		current.clipBottom === next.clipBottom &&
		current.clipTop === next.clipTop &&
		current.hasLeadingOverflow === next.hasLeadingOverflow &&
		current.headerMaskBottom === next.headerMaskBottom &&
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

export function RepositoryFileLiquidSurface({
	files,
	selectedFilePath,
}: RepositoryFileLiquidSurfaceProps): ReactElement {
	const clipPathId = useId();
	const hostRef = useRef<HTMLDivElement>(null);
	const previousSelectedFilePathRef = useRef(selectedFilePath);
	const selectedFile = files?.find((file) => file.path === selectedFilePath);
	const [isMoving, setIsMoving] = useState(false);
	const [measurement, setMeasurement] =
		useState<RepositoryFileLiquidSurfaceMeasurement | null>(null);

	useLayoutEffect(() => {
		const previousSelectedFilePath = previousSelectedFilePathRef.current;
		previousSelectedFilePathRef.current = selectedFilePath;
		const shouldMove =
			previousSelectedFilePath !== null &&
			selectedFilePath !== null &&
			previousSelectedFilePath !== selectedFilePath;
		setIsMoving(shouldMove);
		if (!shouldMove) {
			return;
		}
		const motionTimeout = window.setTimeout(() => {
			setIsMoving(false);
		}, FILE_SURFACE_MOTION_DURATION_MS);
		return () => {
			window.clearTimeout(motionTimeout);
		};
	}, [selectedFilePath]);

	useLayoutEffect(() => {
		const host = hostRef.current;
		const workspace = host?.parentElement;
		const rail = workspace?.querySelector<HTMLElement>(
			'[data-name="RepositoryNavigationRail"]'
		);
		const canvas = workspace?.querySelector<HTMLElement>(
			'[data-name="RepositoryDiffWorkspace"]'
		);
		const fileRail = rail?.querySelector<HTMLElement>(
			'[data-name="RepositoryFileRail"]'
		);
		const viewport = fileRail?.querySelector<HTMLElement>(
			"[data-repository-file-viewport]"
		);
		const stickyLayer = fileRail?.querySelector<HTMLElement>(
			"[data-repository-file-sticky-layer]"
		);
		const fileList = viewport?.querySelector<HTMLElement>(
			'[data-name="RepositoryFileListGroups"]'
		);
		if (
			!(
				workspace &&
				rail &&
				canvas &&
				fileRail &&
				viewport &&
				stickyLayer &&
				fileList &&
				selectedFile
			)
		) {
			setMeasurement(null);
			return;
		}

		const rowSelector = `#${CSS.escape(
			getRepositoryFileRowId(selectedFile.path)
		)}`;
		const measure = (): void => {
			const row = fileList.querySelector<HTMLElement>(rowSelector);
			const workspaceRect = getRect(workspace);
			const baseMeasurement = row
				? createRepositoryFileLiquidMeasurement(
						workspaceRect,
						getRect(canvas),
						getRect(row),
						getRect(viewport)
					)
				: null;
			const nextMeasurement = baseMeasurement
				? {
						...baseMeasurement,
						hasLeadingOverflow: viewport.scrollTop > 1,
						headerMaskBottom:
							Math.round(
								Math.max(
									0,
									stickyLayer.getBoundingClientRect().bottom -
										(workspaceRect.top + baseMeasurement.surfaceTop)
								) * 10
							) / 10,
					}
				: null;
			setMeasurement((currentMeasurement) =>
				hasSameMeasurement(currentMeasurement, nextMeasurement)
					? currentMeasurement
					: nextMeasurement
			);
		};
		const row = fileList.querySelector<HTMLElement>(rowSelector);
		const tracker = createLiquidGeometryTracker(measure);
		tracker.setElements([
			rail,
			canvas,
			fileRail,
			viewport,
			stickyLayer,
			fileList,
			...(row ? [row] : []),
		]);
		tracker.measureNow();
		return tracker.disconnect;
	}, [selectedFile]);

	const path = useMemo(
		() =>
			measurement ? createRepositoryFileLiquidPath(measurement) : undefined,
		[measurement]
	);
	const surfaceStyle = measurement
		? ({
				"--repository-file-liquid-header-mask-bottom": `${measurement.headerMaskBottom}px`,
				height: measurement.surfaceHeight,
				left: measurement.surfaceLeft,
				top: measurement.surfaceTop,
				width: measurement.surfaceWidth,
			} satisfies RepositoryFileLiquidSurfaceStyle)
		: undefined;

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-10 overflow-visible"
			data-name="RepositoryFileLiquidSurfaceHost"
			ref={hostRef}
		>
			{measurement && path ? (
				<svg
					className="absolute overflow-hidden"
					data-header-masked={
						measurement.headerMaskBottom > 0 ? "true" : undefined
					}
					data-moving={isMoving ? "true" : undefined}
					data-name="RepositoryFileLiquidSurface"
					data-overflow-y-start={
						measurement.hasLeadingOverflow ? "true" : undefined
					}
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${measurement.surfaceWidth} ${measurement.surfaceHeight}`}
				>
					<title>Active file liquid surface</title>
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
						data-name="RepositoryFileLiquidSurfaceFill"
					/>
				</svg>
			) : null}
		</div>
	);
}

import { describe, expect, test } from "bun:test";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "../src/renderer/src/fixture/desktop-toolbar/constants/workspace-tab.js";
import {
	createWorkspaceLiquidMeasurement,
	createWorkspaceLiquidPath,
	getVisibleWorkspaceTabAnchorRect,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-geometry.js";
import {
	interpolateWorkspaceLiquidMeasurement,
	type WorkspaceLiquidMeasurement,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";
import { createLiquidMenuFrame } from "../src/renderer/src/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import {
	createLiquidUnionPath,
	signedDistanceToRoundedBox,
	smoothMinimum,
} from "../src/renderer/src/fixture/liquid-surface/lib/liquid-surface-geometry.js";

const LIQUID_MENU_ANCHOR_GEOMETRY = {
	insetBlock: 4,
	insetInline: 4,
	radius: 10,
} as const;

const pathCoordinates = (path: string): readonly [number, number][] =>
	[...path.matchAll(/[ML] (-?\d+\.\d+) (-?\d+\.\d+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2]),
	]);

type WorkspaceEdge = "left" | "right";

const PATH_COORDINATE_PRECISION_TOLERANCE = 0.01;
const HANDOFF_COORDINATE_PRECISION = 0;

const createMeasuredWorkspacePath = (
	measurement: WorkspaceLiquidMeasurement
): string => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	return createWorkspaceLiquidPath({
		blendRadius: geometry.blendRadius,
		containerDepth: geometry.containerDepth,
		containerOverlap: geometry.containerOverlap,
		containerRadius: geometry.containerRadius,
		containerTop: geometry.toolbarHeight,
		sampleCellSize: geometry.sampleCellSize,
		smoothingPasses: geometry.smoothingPasses,
		surfaceWidth: measurement.surfaceWidth,
		tabHeight: measurement.tabHeight,
		tabLeft: measurement.tabLeft,
		tabRadius: geometry.tabRadius,
		tabTop: measurement.tabTop,
		tabWidth: measurement.tabWidth,
	});
};

const createEdgeMeasurement = (
	surfaceWidth: number,
	edge: WorkspaceEdge,
	tabWidth: number = WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
	edgeClearance = 0
): WorkspaceLiquidMeasurement => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const visibleTabWidth = tabWidth - geometry.tabVisualInsetInline * 2;
	const visibleTabLeft =
		edge === "left"
			? edgeClearance
			: surfaceWidth - edgeClearance - visibleTabWidth;
	return createWorkspaceLiquidMeasurement(
		{ height: geometry.toolbarHeight, left: 0, top: 0, width: surfaceWidth },
		{
			height: geometry.tabHeight,
			left: visibleTabLeft - geometry.tabVisualInsetInline,
			top: geometry.toolbarHeight - geometry.tabHeight - geometry.tabLift,
			width: tabWidth,
		},
		{
			height: geometry.toolbarHeight + geometry.containerOverlap,
			left: 0,
			top: 0,
			width: surfaceWidth,
		}
	);
};

const getHorizontalPathIntersections = (
	coordinates: readonly [number, number][],
	y: number
): readonly number[] => {
	const intersections: number[] = [];
	for (const [index, start] of coordinates.entries()) {
		const end = coordinates[(index + 1) % coordinates.length];
		if (!end) {
			continue;
		}
		const crossesRow =
			(start[1] <= y && end[1] > y) || (end[1] <= y && start[1] > y);
		if (!crossesRow) {
			continue;
		}
		const progress = (y - start[1]) / (end[1] - start[1]);
		intersections.push(start[0] + (end[0] - start[0]) * progress);
	}
	return intersections.sort((first, second) => first - second);
};

const getPathEdgeAtY = (
	coordinates: readonly [number, number][],
	y: number,
	edge: WorkspaceEdge
): number => {
	const intersections = getHorizontalPathIntersections(coordinates, y);
	expect(intersections).toHaveLength(2);
	return edge === "left"
		? (intersections[0] ?? Number.NaN)
		: (intersections.at(-1) ?? Number.NaN);
};

const getContainerEdgeAtY = (
	surfaceWidth: number,
	y: number,
	edge: WorkspaceEdge
): number => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const cornerCenterY = geometry.toolbarHeight + geometry.containerRadius;
	const verticalOffset = Math.max(
		-geometry.containerRadius,
		Math.min(geometry.containerRadius, y - cornerCenterY)
	);
	const cornerOffset = Math.sqrt(
		Math.max(0, geometry.containerRadius ** 2 - verticalOffset ** 2)
	);
	return edge === "left"
		? geometry.containerRadius - cornerOffset
		: surfaceWidth - geometry.containerRadius + cornerOffset;
};

const expectContinuousWorkspacePath = (
	measurement: WorkspaceLiquidMeasurement
): readonly [number, number][] => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const path = createMeasuredWorkspacePath(measurement);
	const coordinates = pathCoordinates(path);
	const horizontalCoordinates = coordinates.map(([x]) => x);
	const handoffY = geometry.toolbarHeight + geometry.containerOverlap;

	expect(path.match(/ Z/g)).toHaveLength(1);
	expect(
		coordinates.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
	).toBe(true);
	expect(Math.min(...horizontalCoordinates)).toBeGreaterThanOrEqual(
		-PATH_COORDINATE_PRECISION_TOLERANCE
	);
	expect(Math.max(...horizontalCoordinates)).toBeLessThanOrEqual(
		measurement.surfaceWidth + PATH_COORDINATE_PRECISION_TOLERANCE
	);
	for (const offset of [-0.5, 0, 0.5]) {
		const y = handoffY + offset;
		for (const edge of ["left", "right"] as const) {
			expect(getPathEdgeAtY(coordinates, y, edge)).toBeCloseTo(
				getContainerEdgeAtY(measurement.surfaceWidth, y, edge),
				HANDOFF_COORDINATE_PRECISION
			);
		}
	}
	return coordinates;
};

describe("workspace liquid geometry", () => {
	test("intersects the workspace tab with its visible viewport", () => {
		const viewport = { height: 47, left: 120, top: 0, width: 420 };

		expect(
			getVisibleWorkspaceTabAnchorRect(
				{ height: 40, left: 120, top: 3, width: 210 },
				viewport
			)
		).toEqual({ height: 32, left: 124, top: 7, width: 202 });
		expect(
			getVisibleWorkspaceTabAnchorRect(
				{ height: 40, left: 84, top: 3, width: 210 },
				viewport
			)
		).toEqual({ height: 32, left: 120, top: 7, width: 170 });
		expect(
			getVisibleWorkspaceTabAnchorRect(
				{ height: 40, left: 516, top: 3, width: 210 },
				viewport
			)
		).toEqual({ height: 32, left: 520, top: 7, width: 20 });
	});

	test("omits a workspace tab outside its visible viewport", () => {
		const viewport = { height: 47, left: 120, top: 0, width: 420 };

		expect(
			getVisibleWorkspaceTabAnchorRect(
				{ height: 40, left: -86, top: 3, width: 210 },
				viewport
			)
		).toBeNull();
		expect(
			getVisibleWorkspaceTabAnchorRect(
				{ height: 40, left: 536, top: 3, width: 210 },
				viewport
			)
		).toBeNull();
	});

	test("tracks scroll, reorder, close, and resize measurements", () => {
		const surface = { height: 46, left: 80, top: 0, width: 900 };
		const viewport = { height: 47, left: 120, top: 0, width: 500 };
		const initial = createWorkspaceLiquidMeasurement(
			surface,
			{ height: 40, left: 124, top: 3, width: 210 },
			viewport
		);
		const scrolled = createWorkspaceLiquidMeasurement(
			surface,
			{ height: 40, left: 88, top: 3, width: 210 },
			viewport
		);
		const reordered = createWorkspaceLiquidMeasurement(
			surface,
			{ height: 40, left: 334, top: 3, width: 210 },
			viewport
		);
		const nextAfterClose = createWorkspaceLiquidMeasurement(
			surface,
			{ height: 40, left: 544, top: 3, width: 210 },
			viewport
		);
		const resized = createWorkspaceLiquidMeasurement(
			{ ...surface, width: 640 },
			{ height: 40, left: 334, top: 3, width: 210 },
			{ ...viewport, width: 400 }
		);

		expect(initial.tabLeft).toBe(48);
		expect(initial.tabWidth).toBe(202);
		expect(scrolled.tabLeft).toBe(40);
		expect(scrolled.tabWidth).toBe(174);
		expect(reordered.tabLeft).toBe(258);
		expect(nextAfterClose.tabLeft).toBe(468);
		expect(nextAfterClose.tabWidth).toBe(72);
		expect(resized.surfaceWidth).toBe(640);
		expect(resized.tabLeft).toBe(reordered.tabLeft);
	});

	test("keeps the workspace container while its active tab is clipped", () => {
		const measurement = createWorkspaceLiquidMeasurement(
			{ height: 46, left: 80, top: 0, width: 900 },
			{ height: 40, left: -90, top: 3, width: 210 },
			{ height: 47, left: 120, top: 0, width: 500 }
		);

		expect(measurement).toEqual({
			surfaceWidth: 900,
			tabHeight: 0,
			tabLeft: 0,
			tabTop: 46,
			tabWidth: 0,
		});
	});

	test("clips the open-menu anchor to the workspace tab viewport", () => {
		const anchorClip = { height: 47, left: 120, top: 0, width: 420 };
		const menu = { height: 262, left: 120, top: 45, width: 288 };
		const partialFrame = createLiquidMenuFrame(
			{
				anchor: { height: 40, left: 84, top: 3, width: 210 },
				anchorClip,
				menu,
				submenu: null,
			},
			{ menu: 1, submenu: 0 },
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const hiddenFrame = createLiquidMenuFrame(
			{
				anchor: { height: 40, left: -126, top: 3, width: 210 },
				anchorClip,
				menu,
				submenu: null,
			},
			{ menu: 1, submenu: 0 },
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const absoluteAnchor = (
			frame: ReturnType<typeof createLiquidMenuFrame>
		): { height: number; left: number; top: number; width: number } => ({
			height: frame.anchor.height,
			left: frame.bounds.left + frame.anchor.left,
			top: frame.bounds.top + frame.anchor.top,
			width: frame.anchor.width,
		});
		const hiddenPathTop = Math.min(
			...pathCoordinates(hiddenFrame.path).map(
				([, top]) => top + hiddenFrame.bounds.top
			)
		);

		expect(absoluteAnchor(partialFrame)).toEqual({
			height: 32,
			left: 120,
			top: 7,
			width: 170,
		});
		expect(absoluteAnchor(hiddenFrame)).toEqual({
			height: 32,
			left: 120,
			top: 7,
			width: 0,
		});
		expect(hiddenPathTop).toBeGreaterThanOrEqual(menu.top - 1);
	});

	test("computes exact rounded-box distances on edges and corners", () => {
		const box = {
			centerX: 20,
			centerY: 15,
			halfHeight: 10,
			halfWidth: 15,
			radius: 4,
		};

		expect(signedDistanceToRoundedBox(20, 15, box)).toBe(-10);
		expect(signedDistanceToRoundedBox(39, 15, box)).toBe(4);
		expect(signedDistanceToRoundedBox(20, 29, box)).toBe(4);
		expect(signedDistanceToRoundedBox(39, 29, box)).toBeCloseTo(
			Math.sqrt(128) - 4
		);
	});

	test("smoothly unions overlapping distance fields", () => {
		expect(smoothMinimum(4, 4, 0)).toBe(4);
		expect(smoothMinimum(4, 4, 16)).toBe(0);
		expect(smoothMinimum(-2, 12, 16)).toBeLessThan(-2);
	});

	test("traces a fused tab and workspace as one SVG contour", () => {
		const path = createWorkspaceLiquidPath({
			blendRadius: 12,
			containerDepth: 48,
			containerOverlap: 1,
			containerRadius: 14,
			containerTop: 46,
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceWidth: 900,
			tabHeight: 48,
			tabLeft: 220,
			tabRadius: 10,
			tabTop: 7,
			tabWidth: 178,
		});

		expect(path.startsWith("M ")).toBe(true);
		expect(path.endsWith(" Z")).toBe(true);
		expect(path.match(/ Z/g)).toHaveLength(1);
		expect(pathCoordinates(path).length).toBeGreaterThan(100);
	});

	test("fuses a tab and floating menu into one liquid contour", () => {
		const path = createLiquidUnionPath({
			blendRadius: 18,
			boxes: [
				{
					centerX: 180,
					centerY: 30,
					halfHeight: 16,
					halfWidth: 101,
					radius: 10,
				},
				{
					centerX: 180,
					centerY: 135,
					halfHeight: 85,
					halfWidth: 144,
					radius: 12,
				},
			],
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceHeight: 240,
			surfaceWidth: 360,
		});

		expect(path.startsWith("M ")).toBe(true);
		expect(path.match(/ Z/g)).toHaveLength(1);
		expect(pathCoordinates(path).length).toBeGreaterThan(100);
	});

	test("grows the floating menu from a connected SDF seed", () => {
		const measurement = {
			anchor: { height: 40, left: 171, top: 3, width: 210 },
			menu: { height: 262, left: 132, top: 45, width: 288 },
			submenu: null,
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 0.001,
				submenu: 0,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const horizontalSpan = (
			coordinates: readonly [number, number][]
		): number => {
			const horizontalCoordinates = coordinates.map(([x]) => x);
			return (
				Math.max(...horizontalCoordinates) - Math.min(...horizontalCoordinates)
			);
		};

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(horizontalSpan(seedCoordinates)).toBeLessThan(
			horizontalSpan(openCoordinates)
		);
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("grows an offset menu from the center of its anchor", () => {
		const frame = createLiquidMenuFrame(
			{
				anchor: { height: 32, left: 88, top: 7, width: 79 },
				menu: { height: 212, left: 72, top: 41, width: 370 },
				submenu: null,
			},
			{
				menu: 0.001,
				submenu: 0,
			},
			{
				insetBlock: 0,
				insetInline: 0,
				radius: 8,
			}
		);

		expect(frame.path.match(/ Z/g)).toHaveLength(1);
		expect(frame.anchor).toEqual({
			height: 32,
			left: 60,
			radius: 8,
			top: 44,
			width: 79,
		});
	});

	test("grows a right-side root menu from the nearest anchor edge", () => {
		const measurement = {
			anchor: { height: 32, left: 88, top: 96, width: 200 },
			menu: { height: 188, left: 296, top: 18, width: 340 },
			submenu: null,
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 0.001,
				submenu: 0,
			},
			{
				insetBlock: 0,
				insetInline: 0,
				radius: 8,
			}
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0,
			},
			{
				insetBlock: 0,
				insetInline: 0,
				radius: 8,
			}
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const maximumX = (coordinates: readonly [number, number][]): number =>
			Math.max(...coordinates.map(([x]) => x));

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(maximumX(openCoordinates)).toBeGreaterThan(
			maximumX(seedCoordinates)
		);
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("grows a submenu from its parent edge as one SDF contour", () => {
		const measurement = {
			anchor: { height: 40, left: 259, top: 3, width: 210 },
			menu: { height: 262, left: 220, top: 45, width: 288 },
			submenu: {
				menu: { height: 196, left: 24, top: 132, width: 192 },
				side: "left" as const,
				trigger: { height: 28, left: 228, top: 174, width: 272 },
			},
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0.001,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 1,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const minimumX = (coordinates: readonly [number, number][]): number =>
			Math.min(...coordinates.map(([x]) => x));

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(minimumX(openCoordinates)).toBeLessThan(minimumX(seedCoordinates));
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("grows a right-side submenu from the nearest parent edge", () => {
		const measurement = {
			anchor: { height: 40, left: 159, top: 3, width: 210 },
			menu: { height: 262, left: 120, top: 45, width: 288 },
			submenu: {
				menu: { height: 196, left: 408, top: 132, width: 192 },
				side: "right" as const,
				trigger: { height: 28, left: 128, top: 174, width: 272 },
			},
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0.001,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 1,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const maximumX = (coordinates: readonly [number, number][]): number =>
			Math.max(...coordinates.map(([x]) => x));

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(maximumX(openCoordinates)).toBeGreaterThan(
			maximumX(seedCoordinates)
		);
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("clips the liquid skin to the workspace bounds", () => {
		const surfaceWidth = 320;
		const path = createWorkspaceLiquidPath({
			blendRadius: 16,
			containerDepth: 48,
			containerOverlap: 1,
			containerRadius: 14,
			containerTop: 46,
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceWidth,
			tabHeight: 40,
			tabLeft: 136,
			tabRadius: 12,
			tabTop: 6,
			tabWidth: 178,
		});
		const coordinates = pathCoordinates(path);
		const horizontalCoordinates = coordinates.map(([x]) => x);

		expect(Math.min(...horizontalCoordinates)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...horizontalCoordinates)).toBeLessThanOrEqual(
			surfaceWidth
		);
	});

	test("renders only the workspace container when the tab is fully clipped", () => {
		const containerTop = 46;
		const path = createWorkspaceLiquidPath({
			blendRadius: 12,
			containerDepth: 48,
			containerOverlap: 1,
			containerRadius: 14,
			containerTop,
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceWidth: 320,
			tabHeight: 0,
			tabLeft: 120,
			tabRadius: 10,
			tabTop: containerTop,
			tabWidth: 0,
		});
		const verticalCoordinates = pathCoordinates(path).map(([, y]) => y);

		expect(path).not.toBe("");
		expect(Math.min(...verticalCoordinates)).toBeGreaterThanOrEqual(
			containerTop
		);
	});

	test("keeps mirrored edge connections continuous across surface widths", () => {
		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		const expectedTabHeight =
			geometry.tabHeight -
			geometry.tabVisualInsetBlock * 2 +
			geometry.tabSdfExtensionBlockEnd;
		const surfaceWidths = [232, 233.3, 234, 235.5, 238, 240, 246, 320.5];

		for (const surfaceWidth of surfaceWidths) {
			const leftMeasurement = createEdgeMeasurement(surfaceWidth, "left");
			const rightMeasurement = createEdgeMeasurement(surfaceWidth, "right");
			const leftCoordinates = expectContinuousWorkspacePath(leftMeasurement);
			const rightCoordinates = expectContinuousWorkspacePath(rightMeasurement);
			const joinTop = geometry.toolbarHeight - geometry.blendRadius;
			const joinBottom =
				geometry.toolbarHeight + geometry.containerRadius - 0.5;

			expect(leftMeasurement.tabHeight).toBe(expectedTabHeight);
			expect(rightMeasurement.tabHeight).toBe(expectedTabHeight);
			for (let y = joinTop + 0.25; y <= joinBottom; y += 0.5) {
				const mirroredWidth =
					getPathEdgeAtY(leftCoordinates, y, "left") +
					getPathEdgeAtY(rightCoordinates, y, "right");
				expect(Math.abs(mirroredWidth - surfaceWidth)).toBeLessThanOrEqual(
					geometry.sampleCellSize / 4
				);
			}
		}
	});

	test("stays continuous through fractional activation interpolation", () => {
		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		const surfaceWidth = 320.5;
		const leftMeasurement = createEdgeMeasurement(surfaceWidth, "left");
		const rightMeasurement = createEdgeMeasurement(surfaceWidth, "right");
		const progressValues = Array.from({ length: 21 }, (_, index) => index / 20);

		for (const progress of progressValues) {
			const measurement = interpolateWorkspaceLiquidMeasurement(
				leftMeasurement,
				rightMeasurement,
				progress
			);

			expect(measurement.tabHeight).toBe(
				geometry.tabHeight -
					geometry.tabVisualInsetBlock * 2 +
					geometry.tabSdfExtensionBlockEnd
			);
			expectContinuousWorkspacePath(measurement);
		}
	});

	test("stays continuous across tab widths and device-pixel snapping", () => {
		const devicePixelRatios = [1, 1.25, 1.5, 2, 3];
		const edgeClearances = [0, 4, 8, 14];
		const tabWidths = [144, 188.5, 210, 260];
		const snap = (value: number, devicePixelRatio: number): number =>
			Math.round(value * devicePixelRatio) / devicePixelRatio;

		for (const devicePixelRatio of devicePixelRatios) {
			for (const tabWidth of tabWidths) {
				const surfaceWidth = snap(340.5, devicePixelRatio);
				for (const edgeClearance of edgeClearances) {
					for (const edge of ["left", "right"] as const) {
						const measurement = createEdgeMeasurement(
							surfaceWidth,
							edge,
							snap(tabWidth, devicePixelRatio),
							snap(edgeClearance, devicePixelRatio)
						);
						expectContinuousWorkspacePath({
							surfaceWidth: snap(measurement.surfaceWidth, devicePixelRatio),
							tabHeight: snap(measurement.tabHeight, devicePixelRatio),
							tabLeft: snap(measurement.tabLeft, devicePixelRatio),
							tabTop: snap(measurement.tabTop, devicePixelRatio),
							tabWidth: snap(measurement.tabWidth, devicePixelRatio),
						});
					}
				}
			}
		}
	});
});

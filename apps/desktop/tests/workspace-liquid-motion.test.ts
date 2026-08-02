import { describe, expect, test } from "bun:test";
import {
	createCollapsedWorkspaceLiquidMeasurement,
	easeWorkspaceLiquidMotion,
	interpolateWorkspaceLiquidMeasurement,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";

describe("workspace liquid motion", () => {
	test("melts the final pill downward into the workspace", () => {
		const measurement = {
			surfaceWidth: 900,
			tabHeight: 48,
			tabLeft: 220,
			tabTop: 4,
			tabWidth: 202,
		};

		const collapsedMeasurement =
			createCollapsedWorkspaceLiquidMeasurement(measurement);

		expect(collapsedMeasurement.tabHeight).toBe(0);
		expect(collapsedMeasurement.tabLeft).toBe(measurement.tabLeft);
		expect(collapsedMeasurement.tabTop).toBe(52);
		expect(collapsedMeasurement.tabWidth).toBe(measurement.tabWidth);
		expect(collapsedMeasurement.surfaceWidth).toBe(measurement.surfaceWidth);
	});

	test("melts a new pill upward from the workspace", () => {
		const measurement = {
			surfaceWidth: 900,
			tabHeight: 48,
			tabLeft: 220,
			tabTop: 4,
			tabWidth: 202,
		};
		const collapsedMeasurement =
			createCollapsedWorkspaceLiquidMeasurement(measurement);

		const midpoint = interpolateWorkspaceLiquidMeasurement(
			collapsedMeasurement,
			measurement,
			0.5
		);

		expect(midpoint.tabHeight).toBe(24);
		expect(midpoint.tabTop).toBe(28);
		expect(midpoint.tabLeft).toBe(measurement.tabLeft);
		expect(midpoint.tabWidth).toBe(measurement.tabWidth);
	});

	test("interpolates a shared pill between workspace tabs", () => {
		const measurement = interpolateWorkspaceLiquidMeasurement(
			{
				surfaceWidth: 800,
				tabHeight: 48,
				tabLeft: 100,
				tabTop: 4,
				tabWidth: 202,
			},
			{
				surfaceWidth: 900,
				tabHeight: 44,
				tabLeft: 320,
				tabTop: 6,
				tabWidth: 180,
			},
			0.5
		);

		expect(measurement).toEqual({
			surfaceWidth: 900,
			tabHeight: 46,
			tabLeft: 210,
			tabTop: 5,
			tabWidth: 191,
		});
	});

	test("matches the workspace tab easing endpoints", () => {
		expect(easeWorkspaceLiquidMotion(0)).toBe(0);
		expect(easeWorkspaceLiquidMotion(1)).toBe(1);
		expect(easeWorkspaceLiquidMotion(0.5)).toBeGreaterThan(0.5);
	});

	test("clamps animation progress before interpolating", () => {
		const start = {
			surfaceWidth: 800,
			tabHeight: 48,
			tabLeft: 100,
			tabTop: 4,
			tabWidth: 202,
		};
		const end = {
			surfaceWidth: 800,
			tabHeight: 48,
			tabLeft: 320,
			tabTop: 4,
			tabWidth: 202,
		};

		expect(interpolateWorkspaceLiquidMeasurement(start, end, -1)).toEqual(
			start
		);
		expect(interpolateWorkspaceLiquidMeasurement(start, end, 2)).toEqual(end);
	});
});

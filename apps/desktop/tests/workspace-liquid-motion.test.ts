import { describe, expect, test } from "bun:test";
import {
	createCollapsedWorkspaceLiquidMeasurement,
	easeWorkspaceLiquidMotion,
	interpolateWorkspaceLiquidMeasurement,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";

describe("workspace liquid motion", () => {
	test("collapses the final pill toward its center", () => {
		const measurement = {
			surfaceWidth: 900,
			tabLeft: 220,
			tabTop: 4,
			tabWidth: 202,
		};

		const collapsedMeasurement =
			createCollapsedWorkspaceLiquidMeasurement(measurement);

		expect(collapsedMeasurement.tabLeft).toBe(321);
		expect(collapsedMeasurement.tabWidth).toBe(0);
		expect(collapsedMeasurement.tabTop).toBe(measurement.tabTop);
		expect(collapsedMeasurement.surfaceWidth).toBe(measurement.surfaceWidth);
	});

	test("interpolates a shared pill between workspace tabs", () => {
		const measurement = interpolateWorkspaceLiquidMeasurement(
			{
				surfaceWidth: 800,
				tabLeft: 100,
				tabTop: 4,
				tabWidth: 202,
			},
			{
				surfaceWidth: 900,
				tabLeft: 320,
				tabTop: 6,
				tabWidth: 180,
			},
			0.5
		);

		expect(measurement).toEqual({
			surfaceWidth: 900,
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
			tabLeft: 100,
			tabTop: 4,
			tabWidth: 202,
		};
		const end = {
			surfaceWidth: 800,
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

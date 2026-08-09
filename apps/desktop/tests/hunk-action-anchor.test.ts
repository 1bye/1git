import { describe, expect, test } from "bun:test";
import { measureHunkActionAnchor } from "../src/renderer/src/fixture/repository-workspace/lib/hunk-action-anchor.js";

const geometryElement = (
	rect: {
		readonly height: number;
		readonly left: number;
		readonly top: number;
		readonly width: number;
	},
	isConnected = true
): Pick<Element, "getBoundingClientRect" | "isConnected"> => ({
	getBoundingClientRect: () => rect as DOMRect,
	isConnected,
});

describe("hunk action anchor", () => {
	test("keeps raw geometry while clipping visible pixels to the diff viewport", () => {
		const anchor = geometryElement({
			height: 20,
			left: 88,
			top: 42,
			width: 20,
		});
		const viewport = geometryElement({
			height: 240,
			left: 96,
			top: 24,
			width: 320,
		});

		expect(measureHunkActionAnchor(anchor, viewport)).toEqual({
			anchor: { height: 20, left: 88, top: 42, width: 20 },
			visibleAnchor: { height: 20, left: 96, top: 42, width: 12 },
		});
	});

	test("returns no anchor when it is fully clipped", () => {
		const anchor = geometryElement({
			height: 20,
			left: 40,
			top: 42,
			width: 20,
		});
		const viewport = geometryElement({
			height: 240,
			left: 96,
			top: 24,
			width: 320,
		});

		expect(measureHunkActionAnchor(anchor, viewport)).toBeNull();
	});

	test("returns no anchor after the source or viewport disconnects", () => {
		const rect = { height: 20, left: 96, top: 42, width: 20 };
		const connected = geometryElement(rect);

		expect(
			measureHunkActionAnchor(geometryElement(rect, false), connected)
		).toBeNull();
		expect(
			measureHunkActionAnchor(connected, geometryElement(rect, false))
		).toBeNull();
		expect(measureHunkActionAnchor(connected, null)).toBeNull();
	});
});

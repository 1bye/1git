import { describe, expect, test } from "bun:test";

import {
	measureHunkActionAnchor,
	measureHunkActionBounds,
	measureHunkActionSelection,
} from "../src/renderer/src/fixture/repository-workspace/lib/hunk-action-anchor.js";

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

	test("keeps a captured anchor after Pierre removes its hover utility", () => {
		const viewport = geometryElement({
			height: 240,
			left: 96,
			top: 24,
			width: 320,
		});

		expect(
			measureHunkActionBounds(
				{ height: 20, left: 88, top: 42, width: 20 },
				viewport
			)
		).toEqual({
			anchor: { height: 20, left: 88, top: 42, width: 20 },
			visibleAnchor: { height: 20, left: 96, top: 42, width: 12 },
		});
	});

	test("falls back when Pierre leaves a connected zero-sized utility", () => {
		const viewport = geometryElement({
			height: 240,
			left: 80,
			top: 24,
			width: 320,
		});

		expect(
			measureHunkActionSelection(
				geometryElement({ height: 0, left: 0, top: 0, width: 0 }),
				{ height: 20, left: 88, top: 42, width: 20 },
				viewport
			)
		).toEqual({
			anchor: { height: 20, left: 88, top: 42, width: 20 },
			visibleAnchor: { height: 20, left: 88, top: 42, width: 20 },
		});
	});
});

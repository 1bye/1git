/**
 * Covers: even resampling, matching piece counts across themes, and scaling out of the pill.
 * Real: pill-shapes geometry.
 * Doubles: none.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import {
	easeOutBack,
	growOrigin,
	scaleFrom,
	placePiece,
	resample,
	SAMPLES,
	scenes,
	shapes,
} from "../../src/scripts/pill-shapes";

test("resample spaces points evenly along the line", () => {
	const points = resample(
		[
			[0, 0],
			[3, 0],
			[3, 3],
		],
		7
	);

	const gaps = points.slice(1).map(([x, y], i) => {
		const [px, py] = points[i] as [number, number];

		return Math.hypot(x - px, y - py);
	});

	expect(points).toHaveLength(7);

	for (const gap of gaps) expect(gap).toBeCloseTo(1, 5);
});

test("every shape has the same point count so any shape morphs into any other", () => {
	for (const shape of Object.values(shapes))
		expect(shape).toHaveLength(SAMPLES);
});

test("every theme has the same number of pieces", () => {
	const counts = new Set(Object.values(scenes).map((pieces) => pieces.length));

	expect(counts.size).toBe(1);
});

test("rooted pieces start at the pill's top edge", () => {
	const [rose] = scenes.Rose ?? [];

	if (!rose) throw new Error("Rose scene is empty");

	const pill = { left: 0, top: 100, width: 120, height: 46 };
	const [base] = placePiece(rose, pill, 0, 0);

	// The outline starts at one side of the stem, a hair from the anchor.
	expect(Math.abs((base?.[0] ?? 0) - 60)).toBeLessThan(2);
	expect(base?.[1]).toBeCloseTo(100 + rose.oy, 5);
});

test("a free piece scales out of the nearest point on its pill", () => {
	const pill = { left: 0, top: 0, width: 120, height: 46 };
	const star = scenes.Cosmic?.[0];

	if (!star) throw new Error("Cosmic scene is empty");

	const shape = placePiece(star, pill, 0, 0);
	const origin = growOrigin(star, shape, pill);

	expect(origin[0]).toBeCloseTo(60, 0);
	expect(origin[1]).toBe(0);

	for (const point of scaleFrom(shape, origin, 0))
		expect(point).toEqual(origin);

	expect(scaleFrom(shape, origin, 1)).toEqual(shape);
});

test("a rooted piece scales up from its base on the pill", () => {
	const pill = { left: 0, top: 0, width: 120, height: 46 };
	const tree = scenes.Forest?.[0];

	if (!tree) throw new Error("Forest scene is empty");

	const origin = growOrigin(tree, placePiece(tree, pill, 0, 0), pill);

	expect(origin).toEqual([60, tree.oy]);
});

test("the pop eases past full size and settles at it", () => {
	expect(easeOutBack(0)).toBeCloseTo(0, 5);
	expect(Math.max(...[0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
	expect(easeOutBack(1)).toBeCloseTo(1, 5);
});

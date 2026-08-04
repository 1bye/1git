import { describe, expect, test } from "bun:test";
import {
	getOverflowingLabelMarqueeDuration,
	getOverflowingLabelOverflow,
} from "../src/renderer/src/fixture/overflowing-label/lib/overflowing-label.js";

describe("overflowing label", () => {
	test("only reports meaningful horizontal overflow", () => {
		expect(getOverflowingLabelOverflow(120, 120)).toBe(0);
		expect(getOverflowingLabelOverflow(120, 120.5)).toBe(0);
		expect(getOverflowingLabelOverflow(120, 121.5)).toBe(2);
	});

	test("scales marquee duration with travel and keeps it bounded", () => {
		expect(getOverflowingLabelMarqueeDuration(10)).toBe(700);
		expect(getOverflowingLabelMarqueeDuration(48)).toBe(1000);
		expect(getOverflowingLabelMarqueeDuration(240)).toBe(2200);
	});
});

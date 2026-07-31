import { describe, expect, test } from "bun:test";
import {
	getWorkspaceTabLabelMarqueeDuration,
	getWorkspaceTabLabelOverflow,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-tab-label.js";

describe("workspace tab label overflow", () => {
	test("only reports meaningful horizontal overflow", () => {
		expect(getWorkspaceTabLabelOverflow(120, 120)).toBe(0);
		expect(getWorkspaceTabLabelOverflow(120, 120.5)).toBe(0);
		expect(getWorkspaceTabLabelOverflow(120, 121.5)).toBe(2);
	});

	test("scales marquee duration with travel and keeps it bounded", () => {
		expect(getWorkspaceTabLabelMarqueeDuration(10)).toBe(700);
		expect(getWorkspaceTabLabelMarqueeDuration(48)).toBe(1000);
		expect(getWorkspaceTabLabelMarqueeDuration(240)).toBe(2200);
	});
});

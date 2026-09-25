import { describe, expect, test } from "bun:test";

import {
	getConstrainedMenuAlignOffset,
	getContextMenuPointerClientX,
} from "@/fixture/liquid-menu/lib/liquid-menu-position.js";

const position = (pointerClientX: number | null): number =>
	getConstrainedMenuAlignOffset({
		anchorLeft: 100,
		anchorWidth: 360,
		inlineInset: 8,
		menuWidth: 240,
		pointerClientX,
	});

describe("liquid menu pointer position", () => {
	test("centers a keyboard-opened menu within its anchor", () => {
		expect(position(null)).toBe(60);
	});

	test("centers the menu beneath the pointer when space allows", () => {
		expect(position(280)).toBe(60);
	});

	test("keeps the menu inside the anchor near either edge", () => {
		expect(position(105)).toBe(8);
		expect(position(455)).toBe(112);
	});

	test("uses the browser's zero-coordinate sentinel for keyboard invocation", () => {
		expect(getContextMenuPointerClientX({ clientX: 0, clientY: 0 })).toBeNull();
		expect(getContextMenuPointerClientX({ clientX: 350, clientY: 91 })).toBe(
			350
		);
	});
});

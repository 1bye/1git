import { describe, expect, test } from "bun:test";
import { scrollElementIntoViewport } from "../src/renderer/src/fixture/repository-workspace/lib/scroll-element-into-viewport.js";

const rect = (top: number, bottom: number): DOMRect =>
	({ bottom, top }) as DOMRect;

const elementWithRect = (top: number, bottom: number): HTMLElement =>
	({
		getBoundingClientRect: () => rect(top, bottom),
	}) as HTMLElement;

describe("repository scoped scrolling", () => {
	test("moves only the supplied viewport to reveal the nearest edge", () => {
		const viewport = {
			getBoundingClientRect: () => rect(100, 300),
			scrollTop: 40,
		} as HTMLElement;

		scrollElementIntoViewport(viewport, elementWithRect(280, 320));

		expect(viewport.scrollTop).toBe(60);
	});

	test("aligns an element to an offset inside its viewport", () => {
		const viewport = {
			getBoundingClientRect: () => rect(100, 300),
			scrollTop: 40,
		} as HTMLElement;

		scrollElementIntoViewport(viewport, elementWithRect(180, 220), {
			block: "start",
			offset: 8,
		});

		expect(viewport.scrollTop).toBe(112);
	});

	test("does not move an already visible viewport", () => {
		const viewport = {
			getBoundingClientRect: () => rect(100, 300),
			scrollTop: 40,
		} as HTMLElement;

		scrollElementIntoViewport(viewport, elementWithRect(140, 180));

		expect(viewport.scrollTop).toBe(40);
	});
});

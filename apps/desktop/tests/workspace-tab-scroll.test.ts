import { describe, expect, test } from "bun:test";

import {
	getWorkspaceTabRevealFrame,
	getWorkspaceTabRevealScrollLeft,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-tab-scroll.js";

const commonInput = {
	currentScrollLeft: 300,
	maximumScrollLeft: 700,
	viewportLeft: 100,
	viewportRight: 500,
} as const;

describe("workspace tab horizontal reveal", () => {
	test("reveals fully and partially clipped tabs by their nearest edge", () => {
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				tabLeft: -110,
				tabRight: 90,
			})
		).toBe(90);
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				tabLeft: 60,
				tabRight: 260,
			})
		).toBe(260);
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				tabLeft: 510,
				tabRight: 710,
			})
		).toBe(510);
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				tabLeft: 460,
				tabRight: 660,
			})
		).toBe(460);
	});

	test("keeps a fully visible tab at the current scroll position", () => {
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				tabLeft: 160,
				tabRight: 360,
			})
		).toBe(commonInput.currentScrollLeft);
	});

	test("clamps wrapped endpoint reveals to the rail scroll range", () => {
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				currentScrollLeft: commonInput.maximumScrollLeft,
				tabLeft: -700,
				tabRight: -500,
			})
		).toBe(0);
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				currentScrollLeft: 0,
				tabLeft: 1200,
				tabRight: 1400,
			})
		).toBe(commonInput.maximumScrollLeft);
		expect(
			getWorkspaceTabRevealScrollLeft({
				...commonInput,
				currentScrollLeft: 0,
				maximumScrollLeft: -20,
				tabLeft: 510,
				tabRight: 710,
			})
		).toBe(0);
	});

	test("animates quickly in either direction and lands exactly on target", () => {
		const forwardFrame = getWorkspaceTabRevealFrame({
			durationMs: 140,
			elapsedMs: 70,
			initialScrollLeft: 100,
			targetScrollLeft: 500,
		});
		const reverseFrame = getWorkspaceTabRevealFrame({
			durationMs: 140,
			elapsedMs: 70,
			initialScrollLeft: 500,
			targetScrollLeft: 100,
		});

		expect(forwardFrame.isComplete).toBe(false);
		expect(forwardFrame.scrollLeft).toBeGreaterThan(300);
		expect(forwardFrame.scrollLeft).toBeLessThan(500);
		expect(reverseFrame.scrollLeft).toBe(600 - forwardFrame.scrollLeft);
		expect(
			getWorkspaceTabRevealFrame({
				durationMs: 140,
				elapsedMs: 140,
				initialScrollLeft: 100,
				targetScrollLeft: 500,
			})
		).toEqual({
			isComplete: true,
			scrollLeft: 500,
		});
		expect(
			getWorkspaceTabRevealFrame({
				durationMs: 0,
				elapsedMs: 0,
				initialScrollLeft: 100,
				targetScrollLeft: 500,
			})
		).toEqual({
			isComplete: true,
			scrollLeft: 500,
		});
	});
});

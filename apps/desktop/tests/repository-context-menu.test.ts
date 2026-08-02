import { describe, expect, test } from "bun:test";
import {
	isRepositoryContextMenuKey,
	shouldOpenRepositoryInBackground,
} from "@/fixture/repository-item/lib/repository-context-menu.js";

describe("repository context menu", () => {
	test("supports the native keyboard context-menu gestures", () => {
		expect(isRepositoryContextMenuKey("ContextMenu", false)).toBe(true);
		expect(isRepositoryContextMenuKey("F10", true)).toBe(true);
		expect(isRepositoryContextMenuKey("F10", false)).toBe(false);
	});

	test("keeps modifier-opened repositories in the background", () => {
		expect(shouldOpenRepositoryInBackground(true, false)).toBe(true);
		expect(shouldOpenRepositoryInBackground(false, true)).toBe(true);
		expect(shouldOpenRepositoryInBackground(false, false)).toBe(false);
	});
});

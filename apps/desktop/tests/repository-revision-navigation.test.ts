import { describe, expect, test } from "bun:test";
import {
	getRepositoryRevisionNavigationGroupTarget,
	getRepositoryRevisionNavigationTarget,
} from "../src/renderer/src/fixture/repository-workspace/lib/repository-revision-navigation.js";

const ITEMS = ["one", "two", "three"] as const;

describe("repository revision navigation", () => {
	test("moves vertically without wrapping", () => {
		expect(
			getRepositoryRevisionNavigationTarget(ITEMS, "one", "ArrowDown")
		).toBe("two");
		expect(getRepositoryRevisionNavigationTarget(ITEMS, "two", "ArrowUp")).toBe(
			"one"
		);
		expect(getRepositoryRevisionNavigationTarget(ITEMS, "one", "ArrowUp")).toBe(
			"one"
		);
		expect(
			getRepositoryRevisionNavigationTarget(ITEMS, "three", "ArrowDown")
		).toBe("three");
	});

	test("enters a list from the nearest directional edge", () => {
		expect(
			getRepositoryRevisionNavigationTarget(ITEMS, null, "ArrowDown")
		).toBe("one");
		expect(getRepositoryRevisionNavigationTarget(ITEMS, null, "ArrowUp")).toBe(
			"three"
		);
		expect(
			getRepositoryRevisionNavigationTarget(ITEMS, "one", "ArrowRight")
		).toBeNull();
	});

	test("moves focus only between adjacent visible groups", () => {
		expect(
			getRepositoryRevisionNavigationGroupTarget("revisions", "ArrowLeft")
		).toBe("files");
		expect(
			getRepositoryRevisionNavigationGroupTarget("files", "ArrowRight")
		).toBe("revisions");
		expect(
			getRepositoryRevisionNavigationGroupTarget("files", "ArrowLeft")
		).toBeNull();
		expect(
			getRepositoryRevisionNavigationGroupTarget("revisions", "ArrowRight")
		).toBeNull();
	});
});

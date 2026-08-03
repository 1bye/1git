import { describe, expect, test } from "bun:test";
import {
	getNextRepositoryPickerId,
	reconcileRepositoryPickerId,
} from "@/fixture/repository-picker/lib/repository-picker-navigation.js";

describe("repository picker navigation", () => {
	test("advances through visible repositories and wraps", () => {
		const visibleIds = ["one", "two", "three"];

		expect(getNextRepositoryPickerId(visibleIds, "one")).toBe("two");
		expect(getNextRepositoryPickerId(visibleIds, "three")).toBe("one");
		expect(getNextRepositoryPickerId(visibleIds, null)).toBe("one");
		expect(getNextRepositoryPickerId([], "one")).toBeNull();
	});

	test("keeps a preferred repository when it remains visible", () => {
		expect(
			reconcileRepositoryPickerId(
				["one", "two", "three"],
				["three", "one", "two"],
				"two"
			)
		).toBe("two");
	});

	test("selects the item that replaces a removed repository", () => {
		expect(
			reconcileRepositoryPickerId(
				["one", "two", "three", "four"],
				["one", "two", "four"],
				"three"
			)
		).toBe("four");
		expect(
			reconcileRepositoryPickerId(
				["one", "two", "three"],
				["one", "two"],
				"three"
			)
		).toBe("two");
	});
});

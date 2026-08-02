import { describe, expect, test } from "bun:test";
import {
	updateRepositoryContextLayerOpen,
	updateRepositoryContextLayerPresence,
} from "@/fixture/repository-item/lib/repository-context-layer.js";
import { shouldOpenRepositoryInBackground } from "@/fixture/repository-item/lib/repository-context-menu.js";

describe("repository context menu", () => {
	test("keeps modifier-opened repositories in the background", () => {
		expect(shouldOpenRepositoryInBackground(true, false)).toBe(true);
		expect(shouldOpenRepositoryInBackground(false, true)).toBe(true);
		expect(shouldOpenRepositoryInBackground(false, false)).toBe(false);
	});

	test("keeps the parent obscured until the child surface finishes closing", () => {
		const openLayer = updateRepositoryContextLayerOpen(
			null,
			"/repos/one",
			true
		);
		const closingLayer = updateRepositoryContextLayerOpen(
			openLayer,
			"/repos/one",
			false
		);

		expect(closingLayer).toEqual({
			isOpen: false,
			repositoryPath: "/repos/one",
		});
		expect(
			updateRepositoryContextLayerPresence(closingLayer, "/repos/one", false)
		).toBeNull();
	});

	test("ignores lifecycle events from another repository item", () => {
		const openLayer = {
			isOpen: true,
			repositoryPath: "/repos/one",
		};

		expect(
			updateRepositoryContextLayerPresence(openLayer, "/repos/two", false)
		).toEqual(openLayer);
	});
});

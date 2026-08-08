import { describe, expect, test } from "bun:test";
import {
	updateRepositoryContextLayerOpen,
	updateRepositoryContextLayerPresence,
} from "@/fixture/repository-item/lib/repository-context-layer.js";

describe("repository context menu", () => {
	test("keeps the child layer mounted until its surface finishes closing", () => {
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

/**
 * Covers: recent ordering, checkout identity, and ranked multi-word repository search.
 * Real: switcher catalog and machine location model.
 * Doubles: machine labels and known repository metadata; no I/O.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryQuickSwitcherModel as Switcher } from "../../src/feature/repository-discovery/repository-quick-switcher-model";
import { MachineLocation } from "../../src/feature/machines/machine-location";

it("deduplicates in recent order while preserving identical paths on different machines", () => {
	const remote = MachineLocation.encode(
		"00000000-0000-4000-8000-000000000001",
		"/test/project"
	);

	const items = Switcher.catalog(
		[remote, "/test/project", remote, "/test/another"],
		[{ path: "/test/project", name: "Project", branch: "feature/ui" }],
		() => "Devbox"
	);

	expect(items.map((item) => item.path)).toEqual([
		remote,
		"/test/project",
		"/test/another",
	]);
	expect(items[0]).toMatchObject({
		name: "project",
		displayPath: "/test/project",
		machine: "Devbox",
		open: false,
	});
	expect(items[1]).toMatchObject({
		name: "Project",
		machine: "This Mac",
		branch: "feature/ui",
		open: true,
	});
	expect(Switcher.search(items, "  ")).toBe(items);
	expect(
		Switcher.search(items, "DEVBOX project").map((item) => item.path)
	).toEqual([remote]);
	expect(Switcher.search(items, "feature/UI").map((item) => item.path)).toEqual(
		["/test/project"]
	);
});

it("ranks exact names ahead of prefixes, substrings and directory matches", () => {
	const items = Switcher.catalog(
		["/test/alpha/nested", "/test/my-alpha", "/test/alpha-kit", "/test/alpha"],
		[],
		() => "SSH"
	);

	expect(Switcher.search(items, "alpha").map((item) => item.name)).toEqual([
		"alpha",
		"alpha-kit",
		"my-alpha",
		"nested",
	]);
	expect(Switcher.search(items, "missing")).toEqual([]);
	expect(Switcher.search(items, "alpha test")).toHaveLength(4);
});

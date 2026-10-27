/**
 * Covers: recent ordering, checkout identity, and ranked multi-word repository search.
 * Real: switcher catalog and machine location model.
 * Doubles: machine labels and known repository metadata; no I/O.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryQuickSwitcherModel as Switcher } from "../../src/feature/repository-discovery/repository-quick-switcher-model";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import {
	repositoryPaletteActions,
	searchRepositoryPaletteActions,
} from "../../src/feature/repository-discovery/repository-palette-actions";
import { repositoryPaletteSyncChoice } from "../../src/feature/repository-discovery/repository-palette-sync";

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

it("keeps actions discoverable while disabling repository work on Home", () => {
	const actions = repositoryPaletteActions(
		{},
		{
			hasRepository: false,
			canFetch: false,
			canBranch: false,
			canSynchronize: false,
			canStash: false,
			canReveal: false,
			canClose: false,
		}
	);

	expect(actions[0]).toMatchObject({ id: "settings", icon: "settings" });
	expect(
		searchRepositoryPaletteActions(actions, "new").map((item) => item.id)
	).toEqual(["new-tab", "new-branch"]);
	const fetchIndex = actions.findIndex((item) => item.id === "fetch");

	for (const id of [
		"new-tab",
		"close-tab",
		"install-launcher",
		"uninstall-launcher",
		"settings:application",
		"settings:accounts",
		"settings:ai",
	]) {
		expect(actions.findIndex((item) => item.id === id)).toBeLessThan(
			fetchIndex
		);
	}

	expect(
		actions.findIndex((item) => item.id === "settings:repository-remotes")
	).toBeGreaterThan(fetchIndex);
	expect(
		actions.find((item) => item.id === "settings:repository-remotes")?.enabled
	).toBe(false);
	expect(actions.find((item) => item.id === "stash")?.icon).toBe("archive");
	expect(actions.find((item) => item.id === "settings:accounts")?.icon).toBe(
		"userCircle"
	);
	expect(actions.find((item) => item.id === "fetch")?.enabled).toBe(false);
	expect(actions.find((item) => item.id === "settings")?.enabled).toBe(true);
	expect(actions.find((item) => item.id === "install-launcher")?.enabled).toBe(
		false
	);
	expect(actions.find((item) => item.id === "settings:accounts")?.enabled).toBe(
		true
	);
	expect(
		searchRepositoryPaletteActions(actions, "new branch").map((item) => item.id)
	).toEqual(["new-branch"]);
});

it("enables packaged command installation actions when a bundle is available", () => {
	const actions = repositoryPaletteActions(
		{},
		{
			hasRepository: true,
			canFetch: false,
			canBranch: false,
			canSynchronize: false,
			canStash: false,
			canReveal: false,
			canClose: false,
			launcherAvailable: true,
		}
	);

	expect(actions.find((item) => item.id === "install-launcher")).toMatchObject({
		enabled: true,
		hint: "Packaged app only",
	});
	expect(
		actions.find((item) => item.id === "uninstall-launcher")?.enabled
	).toBe(true);
});

it("keeps Pull and Push as explicit upstream operations", () => {
	const branch = {
		upstreamRemote: "origin",
		upstreamRef: "refs/heads/main",
	};

	expect(repositoryPaletteSyncChoice("pull", branch)).toEqual({
		kind: "pull",
		remote: "origin",
		remoteRef: "refs/heads/main",
	});
	expect(repositoryPaletteSyncChoice("push", branch)).toEqual({
		kind: "push",
		remote: "origin",
		remoteRef: "refs/heads/main",
	});
	expect(
		repositoryPaletteSyncChoice("pull", {
			upstreamRemote: null,
			upstreamRef: null,
		})
	).toBeNull();
});

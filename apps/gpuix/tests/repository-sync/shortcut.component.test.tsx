/**
 * Covers: Command-R fetch routing, no-remote refresh fallback and shortcut guards.
 * Real: App, workspace connection/mutation coordination and native key dispatch.
 * Doubles: Repository reads/fetches with controllable results; no live Git or network.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { RepositorySnapshot } from "@1git/git";
import { App } from "../../src/app";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { windowOptions } from "../../src/window-options";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 700,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});

afterEach(() => root.unmount());

const session = (): WorkspaceSessionDocument => ({
	version: 1,
	tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
	activeId: "workspace-1",
	onboarding: "complete",
});

const loaded = (
	remoteCount: number
): RepositorySnapshot & { readonly remoteCount: number } => ({
	...repositorySnapshot(),
	remoteCount,
});

const settle = async (): Promise<void> => {
	for (let pass = 0; pass < 4; pass++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
};

const sendRefresh = (testId = "workspace-1"): void => {
	const element = root.renderer.findByTestId(testId);

	if (!element) throw new Error(`Missing ${testId}`);

	root.renderer.nativeSimulateKeyDown(element.id, "cmd-r");
	root.renderer.flush();
};

it("fetches through the existing mutation path, then reads the repository again", async () => {
	const events: string[] = [];

	const readRepository = mock<typeof RepositoryReader.read>(async () => {
		events.push("read");

		return { ok: true, value: loaded(1) };
	});

	const fetchRepository = mock<typeof RepositorySync.fetch>(async () => {
		events.push("fetch");

		return {
			ok: true,
			value: {
				operation: "fetch",
				remote: "origin",
				branch: "main",
				snapshot: loaded(1),
			},
		};
	});

	root.render(
		<App
			initialSession={session()}
			readRepository={readRepository}
			fetchRepository={fetchRepository}
		/>
	);
	await settle();

	sendRefresh();
	await settle();

	expect(fetchRepository).toHaveBeenCalledTimes(1);
	expect(events).toEqual(["read", "fetch", "read"]);
});

it("refreshes locally without fetching when the repository has no remotes", async () => {
	const events: string[] = [];

	const readRepository = mock<typeof RepositoryReader.read>(async () => {
		events.push("read");

		return { ok: true, value: loaded(0) };
	});

	const fetchRepository = mock<typeof RepositorySync.fetch>(async () => {
		events.push("fetch");

		return {
			ok: true,
			value: {
				operation: "fetch",
				remote: "origin",
				branch: "main",
				snapshot: loaded(0),
			},
		};
	});

	root.render(
		<App
			initialSession={session()}
			readRepository={readRepository}
			fetchRepository={fetchRepository}
		/>
	);
	await settle();

	sendRefresh();
	await settle();

	expect(fetchRepository).not.toHaveBeenCalled();
	expect(events).toEqual(["read", "read"]);
});

it("shows a fetch error from Command-R in synchronization controls", async () => {
	const readRepository = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: loaded(1),
	}));

	const fetchRepository = mock<typeof RepositorySync.fetch>(async () => ({
		ok: false,
		error: {
			code: "command-failed",
			operation: "fetch",
			message: "Fetch failed",
			retryable: false,
		},
	}));

	root.render(
		<App
			initialSession={session()}
			readRepository={readRepository}
			fetchRepository={fetchRepository}
		/>
	);
	await settle();

	sendRefresh();
	await settle();

	expect(fetchRepository).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	const syncButton = root.renderer.findByTestId("rail-sync");

	if (!syncButton) throw new Error("Missing rail sync button");

	const bounds = root.renderer.getElementBounds(syncButton.id);

	if (!bounds) throw new Error("Missing rail sync bounds");

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();

	expect(root.renderer.findByTestId("rail-sync-message")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("Fetch failed");
});

it("does not start a second fetch while busy", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	const fetchRepository = mock<typeof RepositorySync.fetch>(
		async () => await pending.promise
	);

	const readRepository = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: loaded(1),
	}));

	root.render(
		<App
			initialSession={session()}
			readRepository={readRepository}
			fetchRepository={fetchRepository}
		/>
	);
	await settle();

	sendRefresh();
	await settle();
	sendRefresh();
	await settle();

	expect(fetchRepository).toHaveBeenCalledTimes(1);

	pending.resolve({
		ok: true,
		value: {
			operation: "fetch",
			remote: "origin",
			branch: "main",
			snapshot: loaded(1),
		},
	});
	await settle();
});

it("does not fetch while loading or without an active repository tab", async () => {
	const loading =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	const readRepository = mock<typeof RepositoryReader.read>(
		() => loading.promise
	);

	const fetchRepository = mock<typeof RepositorySync.fetch>();

	root.render(
		<App
			initialSession={session()}
			readRepository={readRepository}
			fetchRepository={fetchRepository}
		/>
	);
	await settle();

	sendRefresh();
	await settle();

	expect(fetchRepository).not.toHaveBeenCalled();
	loading.resolve({ ok: true, value: loaded(1) });

	root.unmount();
	root = createTestRoot({
		width: 1100,
		height: 700,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const noActiveFetch = mock<typeof RepositorySync.fetch>();

	root.render(
		<App initialTabCount={0} preview fetchRepository={noActiveFetch} />
	);
	await settle();

	sendRefresh("workspace-home");

	expect(noActiveFetch).not.toHaveBeenCalled();
});

it("keeps closing an unloaded tab on Command-W", async () => {
	const loading =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositoryReader.read>>>();

	root.render(
		<App initialSession={session()} readRepository={() => loading.promise} />
	);
	await settle();

	const element = root.renderer.findByTestId("workspace-1");

	if (!element) throw new Error("Missing workspace-1");

	root.renderer.nativeSimulateKeyDown(element.id, "cmd-w");
	root.renderer.flush();

	expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
	loading.resolve({ ok: true, value: loaded(1) });
});

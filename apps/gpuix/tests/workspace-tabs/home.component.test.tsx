/**
 * Covers: fixed Home navigation and tooltip placement, retained drafts/selection, repository opening, background sync and session intent.
 * Real: App, workspace/session models and native layout, pointer and keyboard events.
 * Doubles: account catalog, repository reads, Git sync, session save and offscreen focus notification; no network or user preferences.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { controlSize, iconSize, radius, spacing } from "@1git/design-tokens";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "../../src/feature/workspace-tabs/lib/workspace-session";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let accounts: Accounts;
const snapshot = repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]);

const read = mock<typeof RepositoryReader.read>(async (path) => ({
	ok: true,
	value: {
		...snapshot,
		repository: { ...snapshot.repository, root: path },
		remoteCount: 1,
		head: { ...snapshot.head, upstream: "origin/main" },
	},
}));

const initial: WorkspaceSessionDocument = {
	version: 1,
	tabs: [
		{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
		{ id: "workspace-2", path: "/test/linked", draft: "Other draft" },
	],
	activeId: "workspace-1",
	recentRepositories: ["/test/project", "/test/linked", "/test/third"],
};

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	read.mockClear();
	accounts = new Accounts(new AccountStore("/unused/home-accounts.json"), {
		async read() {
			throw new Error("No credentials expected");
		},
		async write() {},
		async delete() {},
	});
	spyOn(accounts, "load").mockReturnValue([]);
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function node(id: string) {
	const found = root.renderer.findByTestId(id);

	if (!found) throw new Error(`Missing ${id}`);

	return found;
}
function bounds(id: string) {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	return box;
}
function click(id: string) {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(250);
	root.renderer.advanceTime(1);
	root.renderer.flush();
}
function tabCount() {
	return Object.values(root.renderer.getA11yTree().nodes ?? {}).filter(
		(item) =>
			item.aria?.role === "Tab" &&
			![
				"Changes",
				"History",
				"Stashes",
				"Graph",
				"Tile view",
				"List view",
			].includes(item.aria.label ?? "")
	).length;
}

it("matches Home to the rail's button, icon and rounding while centering it with the tab controls", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	const home = bounds("workspace-home");
	const rail = bounds("view-changes");
	const homeIcon = bounds("workspace-home-icon");
	const railIcon = bounds("view-changes-icon");
	const close = bounds("close-workspace-1");

	expect(home).toMatchObject({
		width: controlSize.rail,
		height: controlSize.rail,
	});
	expect(home.width).toBe(rail.width);
	expect(home.height).toBe(rail.height);
	expect(node("workspace-home").style.borderRadius).toBe(radius.lg);
	expect(node("workspace-home").style.borderRadius).toBe(
		node("view-changes").style.borderRadius
	);
	expect(node("workspace-home").style.borderWidth).toBe(0);
	expect(homeIcon).toMatchObject({ width: iconSize.lg, height: iconSize.lg });
	expect(homeIcon.width).toBe(railIcon.width);
	expect(homeIcon.height).toBe(railIcon.height);
	expect(homeIcon.x + homeIcon.width / 2).toBe(home.x + home.width / 2);
	expect(homeIcon.y + homeIcon.height / 2).toBe(close.y + close.height / 2);
	expect(home.y + home.height).toBeLessThan(bounds("workspace").y);
	expect(home.x).toBe(86);
	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(spacing[1]);
	click("workspace-home");
	expect(bounds("workspace-home")).toEqual(home);
	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(spacing[1]);

	// The full button remains clickable, independently of the tab scroll position.
	click("workspace-1");
	root.renderer.nativeSimulateClick(
		home.x + home.width - 1,
		home.y + home.height / 2
	);
	root.renderer.flush();
	expect(node("repository-welcome")).toBeDefined();
});

it("centers Home's tooltip 8px below the full button on hover and keyboard focus without shifting tabs", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	const home = bounds("workspace-home");
	const tab = bounds("hover-workspace-1");

	root.renderer.nativeSimulateMouseMove(
		home.x + home.width / 2,
		home.y + home.height / 2
	);
	expect(root.renderer.findByTestId("workspace-home-tooltip")).toBeUndefined();
	await Bun.sleep(400);
	await settle();
	const tooltip = bounds("workspace-home-tooltip");

	if (process.env.GPUIX_HOME_TOOLTIP_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_HOME_TOOLTIP_SCREENSHOT);

	expect(tooltip.y - home.y - home.height).toBeCloseTo(8, 0);
	expect(tooltip.x + tooltip.width / 2).toBeCloseTo(home.x + home.width / 2, 0);
	expect(bounds("workspace-home")).toEqual(home);
	expect(bounds("hover-workspace-1")).toEqual(tab);

	root.renderer.nativeSimulateMouseMove(800, 300);
	await Bun.sleep(100);
	root.renderer.flush();
	expect(root.renderer.findByTestId("workspace-home-tooltip")).toBeUndefined();
	click("workspace-home");
	// Offscreen test windows need an explicit focus notification.
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: node("workspace-home").id, eventType: "focus" },
			root.renderer
		)
	);
	await settle();
	expect(bounds("workspace-home-tooltip")).toEqual(tooltip);
	expect(bounds("workspace-home")).toEqual(home);
	expect(bounds("hover-workspace-1")).toEqual(tab);
	expect(node("workspace-home-tooltip").customProps?.role).toBe("tooltip");
	root.renderer.nativeSimulateKeyDown(node("workspace-home").id, "escape");
	root.renderer.flush();
	expect(root.renderer.findByTestId("workspace-home-tooltip")).toBeUndefined();
});

it("starts on a shared Home screen and repeated clicks never create empty tabs", async () => {
	root.render(<App accounts={accounts} readRepository={read} />);
	await settle();
	expect(node("repository-welcome")).toBeDefined();
	expect(node("workspace").customProps?.["aria-label"]).toBe("Home");
	expect(node("workspace-home").customProps?.["aria-description"]).toBe(
		"Welcome screen selected"
	);
	expect(bounds("workspace-home").x).toBe(86);
	expect(root.renderer.findByTestId("add-workspace")).toBeUndefined();

	for (let index = 0; index < 3; index++) click("workspace-home");

	expect(tabCount()).toBe(0);
	expect(read).not.toHaveBeenCalled();
});

it("restores Home selection while saved repositories load without stealing the active view", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={{ ...initial, activeId: null }}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	expect(node("repository-welcome")).toBeDefined();
	await settle();
	expect(read).toHaveBeenCalledTimes(2);
	expect(tabCount()).toBe(2);
	expect(node("repository-welcome")).toBeDefined();
	expect(node("workspace-home").customProps?.["aria-description"]).toBe(
		"Welcome screen selected"
	);
	click("workspace-2");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Other draft");
});

it("preserves tabs, drafts, checked files and selection and reuses an already-open repository", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click("entry-a.ts");
	click("include-a.ts");
	const home = bounds("workspace-home");

	click("workspace-home");
	await settle();
	expect(node("repository-welcome")).toBeDefined();
	expect(tabCount()).toBe(2);
	expect(root.renderer.findByTestId("repository-navigation")).toBeUndefined();
	expect(bounds("workspace-home")).toEqual(home);

	if (process.env.GPUIX_HOME_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_HOME_SCREENSHOT);

	click("workspace-home");
	click("welcome-folder-other");
	click("welcome-repository-/test/project");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Keep draft");
	expect(node("include-a.ts").customProps?.["aria-checked"]).toBe(true);
	expect(node("entry-a.ts").customProps?.["aria-selected"]).toBe(true);
	expect(tabCount()).toBe(2);
	expect(
		read.mock.calls.filter(([path]) => path === "/test/project")
	).toHaveLength(1);
	click("workspace-home");
	click("welcome-repository-/test/third");
	await settle();
	expect(node("workspace-3").customProps?.["aria-selected"]).toBe(true);
	expect(tabCount()).toBe(3);
	expect(read.mock.calls.at(-1)?.[0]).toBe("/test/third");
});

it("keeps window-owned sync running while Home is selected and saves Home without losing repository drafts", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof RepositorySync.fetch>>>();

	const fetch = mock<typeof RepositorySync.fetch>(() => pending.promise);
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			readRepository={read}
			fetchRepository={fetch}
			saveSession={save}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click("rail-sync");
	await settle();
	const signal = fetch.mock.calls[0]?.[1];

	click("workspace-home");
	await settle();
	expect(signal?.aborted).toBe(false);
	expect(node("repository-welcome")).toBeDefined();
	click("workspace-1");
	await settle();
	expect(node("rail-sync-progress")).toBeDefined();
	click("workspace-home");
	pending.resolve({
		ok: true,
		value: { operation: "fetch", remote: "origin", branch: "main", snapshot },
	});
	await settle();
	expect(node("repository-welcome")).toBeDefined();
	expect(signal?.aborted).toBe(false);
	root.unmount();
	const document = save.mock.calls.at(-1)?.[0];

	expect(document?.activeId).toBeNull();
	expect(document?.tabs.map((tab) => tab.draft)).toEqual([
		"Keep draft",
		"Other draft",
	]);
	expect(WorkspaceSession.parse(JSON.stringify(document)).activeId).toBeNull();
});

it("keeps Home fixed while tabs overflow and supports keyboard return to the repository", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={{
				version: 1,
				activeId: "workspace-8",
				tabs: Array.from({ length: 8 }, (_, index) => ({
					id: `workspace-${index + 1}`,
					path: `/test/repo-${index}`,
					draft: "",
				})),
			}}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	const home = bounds("workspace-home");

	expect(home.x + home.width).toBeLessThan(bounds("slot-workspace-8").x);
	root.renderer.nativeSimulateKeyDown(node("workspace-home").id, "enter");
	await settle();
	expect(node("repository-welcome")).toBeDefined();
	expect(bounds("workspace-home")).toEqual(home);
	expect(tabCount()).toBe(8);
	root.renderer.nativeSimulateKeyDown(node("workspace-home").id, "right");
	await settle();
	expect(node("workspace-1").customProps?.["aria-selected"]).toBe(true);
	expect(root.renderer.getFocusedElementId()).toBe(node("workspace-1").id);
});

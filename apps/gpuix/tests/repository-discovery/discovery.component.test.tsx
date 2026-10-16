/**
 * Covers: Home-only discovery, search counts, toolbar navigation, suggestions, opening, retry, folder selection and persistent removal.
 * Real: App, session/discovery hooks and GPUIX native layout/input.
 * Doubles: scanner, picker, repository reads, account catalog and session save; no user folders or network.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { homedir } from "node:os";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryProgress,
} from "../../src/feature/repository-discovery/repository-discovery";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;
let accounts: Accounts;

const initial: WorkspaceSessionDocument = {
	version: 1,
	activeId: null,
	tabs: [],
	recentRepositories: ["/test/saved"],
};

const progress: RepositoryDiscoveryProgress = {
	paths: ["/test/saved", "/test/discovered"],
	scanned: 20,
	skipped: 0,
	limited: false,
};

const read = mock<typeof RepositoryReader.read>(async (path) => {
	const snapshot = repositorySnapshot();

	return {
		ok: true,
		value: { ...snapshot, repository: { ...snapshot.repository, root: path } },
	};
});

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	read.mockClear();
	accounts = new Accounts(new AccountStore("/unused/discovery-accounts.json"), {
		async read() {
			throw new Error("No credentials expected");
		},
		async write() {},
		async delete() {},
	});
	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(RepositoryDiscovery, "resolveFolder").mockImplementation(
		async (path) => path
	);
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

function node(id: string) {
	const item = root.renderer.findByTestId(id);

	if (!item) throw new Error(`Missing ${id}`);

	return item;
}
function click(id: string) {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

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
	root.renderer.flush();
}

it("discovers only when Home opens, merges without opening tabs, searches and explicitly opens a suggestion", async () => {
	const scan = mock<typeof RepositoryDiscovery.scan>(async () => progress);

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test/saved", draft: "Keep draft" }],
			}}
			discoverRepositories={scan}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	expect(scan).not.toHaveBeenCalled();
	click("workspace-home");
	await settle();
	expect(scan.mock.calls[0]?.[0]).toEqual([homedir()]);
	expect(read).toHaveBeenCalledTimes(1);
	click("welcome-folder-other");
	expect(node("welcome-repository-/test/discovered")).toBeDefined();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	click("welcome-search");
	root.renderer.simulateKeystrokes("d i s c o v e r e d");
	root.renderer.flush();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/saved")
	).toBeUndefined();
	click("welcome-repository-/test/discovered");
	await settle();
	expect(read.mock.calls.at(-1)?.[0]).toBe("/test/discovered");
	click("workspace-home");
	await settle();
	expect(scan).toHaveBeenCalledTimes(1);
});

it("keeps suggestions usable and updates the search count without moving the toolbar while scanning", async () => {
	const pending = Promise.withResolvers<RepositoryDiscoveryProgress>();

	const scan = mock<typeof RepositoryDiscovery.scan>(
		async (_folders, _signal, report) => {
			report(progress);

			return await pending.promise;
		}
	);

	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			discoverRepositories={scan}
			readRepository={read}
		/>
	);
	await settle();
	click("welcome-folder-other");
	expect(
		node("welcome-repository-/test/discovered").customProps?.disabled
	).not.toBe(true);
	const rail = root.renderer.getElementBounds(node("discovery-rail").id);
	const page = root.renderer.getElementBounds(node("repository-welcome").id);
	const search = root.renderer.getElementBounds(node("welcome-search").id);

	if (!rail || !page) throw new Error("Missing scan rail");

	expect(rail).toMatchObject({
		x: page.x,
		y: page.y,
		width: page.width,
		height: 2,
	});
	expect(node("discovery-rail").customProps?.["aria-label"]).toContain(
		"2 found"
	);
	expect(node("discovery-rail").style.pointerEvents).toBe("none");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	pending.resolve({ ...progress, paths: [...progress.paths, "/test/found"] });
	await settle();
	expect(root.renderer.findByTestId("discovery-rail")).toBeUndefined();
	expect(root.renderer.getElementBounds(node("welcome-search").id)).toEqual(
		search
	);
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 3 repositories"
	);
	expect(node("welcome-repository-/test/found")).toBeDefined();
});

it("scans additional folders independently, persists scope and removal, and ignores a cancelled picker", async () => {
	const scan = mock<typeof RepositoryDiscovery.scan>(async () => progress);
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	const picker = spyOn(root.renderer, "promptForPaths")
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce(["/Volumes/Work"]);

	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			discoverRepositories={scan}
			saveSession={save}
		/>
	);
	await settle();
	click("discovery-folder");
	await settle();
	expect(scan).toHaveBeenCalledTimes(1);
	click("discovery-folder");
	await settle();
	expect(picker).toHaveBeenCalledTimes(2);
	expect(scan.mock.calls.at(-1)?.[0]).toEqual(["/Volumes/Work"]);
	click("welcome-folder-other");
	await settle();
	root.renderer.nativeSimulateMouseMove(600, 310);
	root.renderer.flush();
	// Keyboard activation also works when the remove affordance isn't hovered.
	root.renderer.nativeSimulateKeyDown(
		node("welcome-forget-/test/discovered").id,
		"enter"
	);
	await settle();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
	click("welcome-back");
	const scansBeforeRetry = scan.mock.calls.length;

	Object.assign(root.renderer, { showContextMenu: () => 0 });
	root.renderer.nativeSimulateKeyDown(
		node("welcome-folder-/Volumes/Work").id,
		"shift-f10"
	);
	root.renderer.flush();
	await settle();
	expect(scan).toHaveBeenCalledTimes(scansBeforeRetry + 1);
	expect(scan.mock.calls.at(-1)?.[0]).toEqual(["/Volumes/Work"]);
	click("welcome-folder-other");
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
	root.unmount();
	expect(save.mock.calls.at(-1)?.[0].repositoryDiscovery).toEqual({
		folders: ["/Volumes/Work"],
		hidden: ["/test/discovered"],
	});
});

it("keeps scan metadata out of the layout and shows the repository count in the search placeholder", async () => {
	const scan = mock<typeof RepositoryDiscovery.scan>(async () => ({
		...progress,
		limited: true,
		skipped: 2,
	}));

	root.render(
		<App
			accounts={accounts}
			initialSession={initial}
			discoverRepositories={scan}
		/>
	);
	await settle();

	for (const id of [
		"discovery-summary",
		"discovery-rescan",
		"discovery-incomplete",
	])
		expect(root.renderer.findByTestId(id)).toBeUndefined();

	expect(root.renderer.getAllText()).not.toContain(
		"Scan limit reached. Add a specific scan folder to find more."
	);
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	const folder = root.renderer.getElementBounds(node("discovery-folder").id);

	const control = root.renderer.getElementBounds(
		node("welcome-search-control").id
	);

	const field = root.renderer.getElementBounds(node("welcome-search-field").id);
	const results = root.renderer.getElementBounds(node("welcome-results").id);

	if (!folder || !control || !field || !results)
		throw new Error("Missing discovery layout");

	expect(folder.x).toBeGreaterThanOrEqual(results.x);
	expect(folder.y).toBeGreaterThanOrEqual(results.y);
	expect(node("discovery-folder").style.borderWidth).toBe(0);
	expect(control.height).toBe(40);
	expect(field.width).toBeGreaterThan(150);
	expect(results.y).toBeGreaterThanOrEqual(control.y + control.height);
	expect(root.renderer.findByTestId("discovery-rail")).toBeUndefined();

	if (process.env.GPUIX_DISCOVERY_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DISCOVERY_SCREENSHOT);

	click("welcome-view-list");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	root.unmount();
	expect(scan).toHaveBeenCalledTimes(1);
});

for (const view of ["tiles", "list"] as const) {
	it(`buffers large ${view} collections while keeping the toolbar fixed and keyboard navigation working`, async () => {
		const paths = Array.from(
			{ length: 3000 },
			(_, index) => `/test/project-${index}`
		);

		const scan = mock<typeof RepositoryDiscovery.scan>(async () => ({
			...progress,
			paths,
		}));

		root.render(
			<App
				accounts={accounts}
				initialSession={{
					...initial,
					recentRepositories: [],
					appearance: "dark",
					repositoryLibrary: { view, starred: [] },
				}}
				discoverRepositories={scan}
			/>
		);
		await settle();
		click("welcome-folder-other");
		const list = node("welcome-repositories");

		const listBox = root.renderer.getElementBounds(
			node("welcome-repositories-viewport").id
		);

		const searchBox = root.renderer.getElementBounds(node("welcome-search").id);
		const buttonBox = root.renderer.getElementBounds(node("welcome-back").id);

		if (!listBox) throw new Error("Missing repository list");

		root.renderer.nativeSimulateScrollWheel(
			listBox.x + 20,
			listBox.y + 20,
			0,
			-30000
		);
		root.renderer.flush();
		expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-10000);
		expect(root.renderer.getElementBounds(node("welcome-search").id)).toEqual(
			searchBox
		);
		expect(root.renderer.getElementBounds(node("welcome-back").id)).toEqual(
			buttonBox
		);
		expect(
			root.renderer.findByTestId("welcome-repository-/test/project-2999")
		).toBeUndefined();
		const mounted = root.renderer
			.findByType("div")
			.filter((element) =>
				element.testId?.startsWith("welcome-repository-/test/project-")
			);

		expect(mounted.length).toBeLessThan(300);
		const first = mounted[0];

		if (!first) throw new Error("No buffered repository mounted");

		root.renderer.nativeSimulateKeyDown(first.id, "end");
		root.renderer.flush();
		expect(node("welcome-repository-/test/project-2999")).toBeDefined();
		root.renderer.nativeSimulateKeyDown(
			node("welcome-repository-/test/project-2999").id,
			"home"
		);
		root.renderer.flush();
		expect(node("welcome-repository-/test/project-0")).toBeDefined();

		if (process.env.GPUIX_DISCOVERY_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_DISCOVERY_SCREENSHOT}-${view}.png`
			);
	});
}

it("does not scan preview or unfinished onboarding, and persists hidden suggestions across restart", async () => {
	const scan = mock<typeof RepositoryDiscovery.scan>(async () => progress);

	root.render(<App accounts={accounts} preview discoverRepositories={scan} />);
	await settle();
	expect(scan).not.toHaveBeenCalled();
	root.unmount();
	root = createTestRoot({ width: 980, height: 640 });
	root.render(
		<App
			accounts={accounts}
			initialOnboarding="welcome"
			discoverRepositories={scan}
		/>
	);
	await settle();
	expect(scan).not.toHaveBeenCalled();
	root.unmount();
	root = createTestRoot({ width: 980, height: 640 });
	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				repositoryDiscovery: {
					folders: ["/Work"],
					hidden: ["/test/discovered"],
				},
			}}
			discoverRepositories={scan}
		/>
	);
	await settle();
	expect(scan.mock.calls.map(([folders]) => folders)).toEqual([
		[homedir()],
		["/Work"],
	]);
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
});

it("browses physical folders, stars across groups and restores the saved view without rescanning", async () => {
	const all = ["/Work/api", "/Personal/site", "/outside/legacy"];

	const scan = mock<typeof RepositoryDiscovery.scan>(async ([folder]) => ({
		...progress,
		paths:
			folder === homedir()
				? all
				: all.filter((path) => path.startsWith(`${folder}/`)),
	}));

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				recentRepositories: [],
				appearance: "dark",
				repositoryDiscovery: { folders: ["/Work", "/Personal"], hidden: [] },
			}}
			discoverRepositories={scan}
			saveSession={save}
			readRepository={read}
		/>
	);
	await settle();
	expect(node("welcome-folder-/Work").customProps?.["aria-label"]).toBe(
		"Open Work, 1 repository"
	);
	expect(node("welcome-folder-/Personal")).toBeDefined();
	expect(node("welcome-folder-other")).toBeDefined();
	expect(
		root.renderer.findByTestId("welcome-repository-/Work/api")
	).toBeUndefined();
	expect(scan).toHaveBeenCalledTimes(3);

	if (process.env.GPUIX_LIBRARY_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_LIBRARY_SCREENSHOT}-folders.png`
		);

	click("welcome-folder-/Work");
	expect(node("welcome-repository-/Work/api")).toBeDefined();
	expect(
		root.renderer.findByTestId("welcome-repository-/Personal/site")
	).toBeUndefined();
	root.renderer.nativeSimulateKeyDown(
		node("welcome-star-/Work/api").id,
		"enter"
	);
	root.renderer.flush();
	expect(node("welcome-star-/Work/api").customProps?.["aria-label"]).toBe(
		"Unstar /Work/api"
	);
	click("welcome-view-list");
	expect(node("welcome-repository-/Work/api")).toBeDefined();
	expect(node("welcome-back")).toBeDefined();
	expect(scan).toHaveBeenCalledTimes(3);
	root.unmount();
	const document = save.mock.calls.at(-1)?.[0];

	expect(document?.repositoryLibrary).toEqual({
		starred: ["/Work/api"],
		view: "list",
		folder: "/Work",
	});
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();
	root.render(
		<App
			accounts={accounts}
			initialSession={document}
			discoverRepositories={scan}
			saveSession={save}
		/>
	);
	await settle();
	expect(node("welcome-repository-/Work/api")).toBeDefined();
	click("welcome-view-tiles");
	expect(node("welcome-back")).toBeDefined();
	expect(node("welcome-repository-/Work/api")).toBeDefined();

	if (process.env.GPUIX_LIBRARY_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_LIBRARY_SCREENSHOT}-repositories.png`
		);

	click("welcome-back");
	click("welcome-folder-/Personal");
	root.renderer.nativeSimulateKeyDown(
		node("welcome-star-/Personal/site").id,
		"enter"
	);
	root.renderer.flush();
	click("welcome-back");
	click("welcome-view-list");
	expect(node("welcome-repository-/Work/api")).toBeDefined();
	expect(node("welcome-repository-/Personal/site")).toBeDefined();
	root.renderer.nativeSimulateKeyDown(
		node("welcome-star-/Work/api").id,
		"enter"
	);
	root.renderer.flush();
	expect(
		root.renderer.findByTestId("welcome-repository-/Work/api")
	).toBeUndefined();
	expect(node("welcome-repository-/Personal/site")).toBeDefined();
});

it("retries unavailable folders individually and removes only tracking, retaining saved/starred repositories", async () => {
	let available = false;

	const scan = mock<typeof RepositoryDiscovery.scan>(async ([folder]) => {
		if (folder === "/Volumes/Work" && !available)
			throw new Error("Scan failed");

		return {
			...progress,
			paths: folder === "/Volumes/Work" ? ["/Volumes/Work/api"] : [],
		};
	});

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});
	let choice = 0;

	Object.assign(root.renderer, { showContextMenu: () => choice });
	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				recentRepositories: ["/Volumes/Work/api"],
				repositoryDiscovery: { folders: ["/Volumes/Work"], hidden: [] },
				repositoryLibrary: { starred: ["/Volumes/Work/api"], view: "tiles" },
			}}
			discoverRepositories={scan}
			saveSession={save}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Folder unavailable");
	expect(root.renderer.getAllText()).toContain("Scan failed");
	click("welcome-folder-/Volumes/Work");
	expect(node("welcome-repository-/Volumes/Work/api")).toBeDefined();
	available = true;
	click("welcome-folder-actions");
	await settle();
	expect(root.renderer.getAllText()).not.toContain("Scan failed");
	expect(scan.mock.calls.map(([folders]) => folders)).toEqual([
		[homedir()],
		["/Volumes/Work"],
		["/Volumes/Work"],
	]);
	choice = 2;
	click("welcome-folder-actions");
	await settle();
	expect(
		root.renderer.findByTestId("welcome-folder-/Volumes/Work")
	).toBeUndefined();
	expect(node("welcome-folder-other")).toBeDefined();
	click("welcome-view-list");
	expect(node("welcome-repository-/Volumes/Work/api")).toBeDefined();
	root.unmount();
	const document = save.mock.calls.at(-1)?.[0];

	expect(document?.repositoryDiscovery).toBeUndefined();
	expect(document?.recentRepositories).toEqual(["/Volumes/Work/api"]);
	expect(document?.repositoryLibrary?.starred).toEqual(["/Volumes/Work/api"]);
});

it("counts the current scope and places the back arrow beside search without a folder path label", async () => {
	const paths = ["/Work/api", "/Work/client", "/Personal/site"];

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				recentRepositories: [],
				appearance: "dark",
				repositoryDiscovery: { folders: ["/Work", "/Personal"], hidden: [] },
				repositoryLibrary: {
					view: "tiles",
					starred: ["/Work/api", "/Personal/site"],
				},
			}}
			discoverRepositories={async () => ({ ...progress, paths })}
		/>
	);
	await settle();
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 3 repositories"
	);
	expect(root.renderer.findByTestId("welcome-back")).toBeUndefined();
	click("welcome-folder-/Work");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	await settle();
	const firstTile = root.renderer.getElementBounds(
		node("welcome-row-/Work/api").id
	)!;

	const secondTile = root.renderer.getElementBounds(
		node("welcome-row-/Work/client").id
	)!;

	expect(secondTile.y).toBe(firstTile.y);
	expect(secondTile.x).toBeGreaterThan(firstTile.x);
	expect(node("welcome-back").customProps?.["aria-label"]).toBe(
		"Back to folders"
	);
	expect(root.renderer.getAllText()).not.toContain("/Work");
	const back = root.renderer.getElementBounds(node("welcome-back").id)!;

	const field = root.renderer.getElementBounds(
		node("welcome-search-field").id
	)!;

	const tabs = root.renderer.getElementBounds(node("welcome-view-tabs").id)!;

	const actions = root.renderer.getElementBounds(
		node("welcome-folder-actions").id
	)!;

	expect(back.x + back.width).toBeLessThan(field.x);
	expect(back.y).toBe(field.y);
	expect(back.height).toBe(field.height);
	expect(tabs.x).toBeGreaterThan(field.x + field.width);
	expect(actions.y).toBe(field.y);
	expect(actions.x).toBeGreaterThan(tabs.x + tabs.width);
	const screenshot = process.env.GPUIX_LIBRARY_SEARCH_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.folder.png`);

	click("welcome-search");
	root.renderer.simulateKeystrokes("a p i");
	root.renderer.flush();
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	click("welcome-view-list");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 2 repositories"
	);
	expect(node("welcome-back")).toBeDefined();
	click("welcome-view-tiles");
	root.renderer.nativeSimulateKeyDown(node("welcome-back").id, "enter");
	root.renderer.flush();
	expect(root.renderer.findByTestId("welcome-back")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(node("welcome-search").id);
	expect(node("welcome-search").customProps?.value).toBe("");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 3 repositories"
	);
	click("welcome-folder-/Personal");
	expect(node("welcome-search").customProps?.placeholder).toBe(
		"Search 1 repository"
	);
});

it("bounds simultaneous roots, cancels queued work on unmount and ignores late progress", async () => {
	const pending = Promise.withResolvers<RepositoryDiscoveryProgress>();

	const scan = mock<typeof RepositoryDiscovery.scan>(
		async (_folders, _signal, report) => {
			report(progress);

			return await pending.promise;
		}
	);

	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				repositoryDiscovery: {
					folders: ["/Work", "/Personal", "/More"],
					hidden: [],
				},
			}}
			discoverRepositories={scan}
		/>
	);
	await settle();
	expect(scan).toHaveBeenCalledTimes(2);
	root.unmount();

	for (const [, signal] of scan.mock.calls) expect(signal.aborted).toBe(true);

	pending.resolve(progress);
	await settle();
	expect(scan).toHaveBeenCalledTimes(2);
});

for (const appearance of ["light", "dark"] as const) {
	it(`shows compact starred tiles beside folders and a borderless Add folder tile in ${appearance} mode`, async () => {
		root.unmount();
		root = createTestRoot({
			width: 1280,
			height: 800,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		const paths = [
			"/Work/api",
			"/Work/client",
			"/Personal/site",
			"/outside/legacy",
		];

		const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([]);

		root.render(
			<App
				accounts={accounts}
				initialSession={{
					...initial,
					appearance,
					recentRepositories: [],
					repositoryDiscovery: { folders: ["/Work", "/Personal"], hidden: [] },
					repositoryLibrary: {
						view: "tiles",
						starred: ["/Work/api", "/Personal/site"],
					},
				}}
				discoverRepositories={async () => ({ ...progress, paths })}
				readRepository={read}
			/>
		);
		await settle();
		const folder = root.renderer.getElementBounds(
			node("welcome-folder-/Work").id
		)!;

		const tile = root.renderer.getElementBounds(
			node("welcome-row-/Work/api").id
		)!;

		const add = root.renderer.getElementBounds(node("discovery-folder").id)!;

		expect(tile.height).toBeLessThan(folder.height);
		expect(tile.width).toBeLessThanOrEqual(folder.width);
		expect(add.height).toBe(folder.height);
		expect(add.x + add.width).toBeLessThan(folder.x);
		expect(add.y).toBe(folder.y);
		expect(
			root.renderer.getElementBounds(node("welcome-folder-other").id)?.y
		).toBe(add.y);
		expect(folder.height).toBeLessThan(146);
		expect(tile.height).toBeLessThan(116);
		expect(node("discovery-folder").style.borderWidth).toBe(0);
		expect(node("welcome-starred")).toBeDefined();
		expect(node("welcome-star-/Work/api").customProps?.["aria-label"]).toBe(
			"Unstar /Work/api"
		);
		const screenshot = process.env.GPUIX_LIBRARY_SEARCH_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}.starred-${appearance}.png`
			);

		click("discovery-folder");
		await settle();
		expect(picker).toHaveBeenCalledTimes(1);
		click("welcome-view-list");
		expect(node("welcome-folder-/Work")).toBeDefined();
		expect(node("welcome-repository-/Personal/site")).toBeDefined();
		expect(
			root.renderer.getElementBounds(node("welcome-row-/Work/api").id)?.height
		).toBe(54);

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.list-${appearance}.png`);

		click("welcome-view-tiles");
		root.renderer.nativeSimulateKeyDown(
			node("welcome-star-/Work/api").id,
			"enter"
		);
		root.renderer.flush();
		expect(
			root.renderer.findByTestId("welcome-repository-/Work/api")
		).toBeUndefined();
		expect(node("welcome-folder-/Work")).toBeDefined();
		click("welcome-repository-/Personal/site");
		await settle();
		expect(read.mock.calls.at(-1)?.[0]).toBe("/Personal/site");
	});

	it(`places icon tabs outside the search field in the same row in ${appearance} mode`, async () => {
		root.render(
			<App
				accounts={accounts}
				initialSession={{ ...initial, appearance }}
				discoverRepositories={async () => progress}
			/>
		);
		await settle();
		const control = root.renderer.getElementBounds(
			node("welcome-search-control").id
		)!;

		const search = root.renderer.getElementBounds(node("welcome-search").id)!;

		const field = root.renderer.getElementBounds(
			node("welcome-search-field").id
		)!;

		const tabs = root.renderer.getElementBounds(node("welcome-view-tabs").id)!;

		expect(root.renderer.getAllText()).not.toContain("ALL REPOSITORIES");
		expect(root.renderer.getAllText()).not.toContain("Listed");
		expect(root.renderer.getAllText()).not.toContain("Starred");
		expect(node("welcome-view-tabs").customProps?.role).toBe("tablist");
		expect(node("welcome-view-tiles").customProps).toMatchObject({
			role: "tab",
			"aria-label": "Tile view",
			"aria-selected": true,
			tabIndex: 0,
		});
		expect(node("welcome-view-list").customProps).toMatchObject({
			role: "tab",
			"aria-label": "List view",
			"aria-selected": false,
			tabIndex: -1,
		});
		expect(node("welcome-results").customProps).toMatchObject({
			role: "tabpanel",
			"aria-label": "Repository tiles",
		});
		expect(node("welcome-view-tiles-icon")).toBeDefined();
		expect(node("welcome-view-list-icon")).toBeDefined();
		expect(control.height).toBe(40);
		expect(search.width).toBeGreaterThan(150);
		expect(tabs.x).toBeGreaterThan(field.x + field.width);
		expect(tabs.y).toBe(field.y);
		expect(tabs.height).toBe(field.height);
		expect(tabs.x + tabs.width).toBeLessThanOrEqual(control.x + control.width);
		expect(tabs.y).toBeGreaterThanOrEqual(control.y);
		expect(tabs.y + tabs.height).toBeLessThanOrEqual(
			control.y + control.height
		);
		const screenshot = process.env.GPUIX_LIBRARY_SEARCH_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.png`);

		root.renderer.nativeSimulateMouseMove(
			tabs.x + tabs.width - 16,
			tabs.y + tabs.height / 2
		);
		await Bun.sleep(450);
		root.renderer.flush();
		expect(root.renderer.getAllText()).toContain("List view");
	});
}

it("supports roving tab focus and keeps the search text when switching repository views", async () => {
	root.render(
		<App
			accounts={accounts}
			initialSession={{
				...initial,
				repositoryLibrary: { view: "tiles", starred: ["/test/saved"] },
			}}
			discoverRepositories={async () => progress}
		/>
	);
	await settle();
	click("welcome-search");
	root.renderer.simulateKeystrokes("s a v e d");
	root.renderer.flush();
	expect(node("welcome-repository-/test/saved")).toBeDefined();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
	// Send the navigation key without the test helper's synthetic IME text input.
	root.renderer.nativeSimulateKeyDown(node("welcome-search").id, "tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		node("welcome-view-tiles").id
	);
	root.renderer.simulateKeystrokes("right");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		node("welcome-view-list").id
	);
	expect(node("welcome-view-list").customProps?.["aria-selected"]).toBe(true);
	expect(node("welcome-view-tiles").customProps?.tabIndex).toBe(-1);
	expect(node("welcome-search").customProps?.value).toBe("saved");
	expect(node("welcome-search").customProps?.["aria-label"]).toBe(
		"Search repositories"
	);
	expect(node("welcome-results").customProps?.["aria-label"]).toBe(
		"Repository list"
	);
	expect(node("welcome-repository-/test/saved")).toBeDefined();

	for (const [key, view] of [
		["right", "tiles"],
		["end", "list"],
		["home", "tiles"],
		["left", "list"],
		["space", "list"],
		["enter", "list"],
	] as const) {
		root.renderer.simulateKeystrokes(key);
		root.renderer.flush();
		expect(root.renderer.getFocusedElementId()).toBe(
			node(`welcome-view-${view}`).id
		);
		expect(node(`welcome-view-${view}`).customProps?.["aria-selected"]).toBe(
			true
		);
		expect(node("welcome-search").customProps?.value).toBe("saved");
	}

	click("welcome-view-tiles");
	expect(node("welcome-search").customProps?.value).toBe("saved");
});

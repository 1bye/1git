/**
 * Covers: Home-only discovery, deduplicated suggestions, opening, cancel/retry, folder selection and persistent removal.
 * Real: App, session/discovery hooks and GPUIX native layout/input.
 * Doubles: scanner, picker, repository reads, account catalog and session save; no user folders or network.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { homedir } from "node:os";
import { App } from "../../src/app";
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
	root = createTestRoot({ width: 980, height: 640 });
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

it("keeps suggestions usable during scanning, cancels stale results and retries after failure", async () => {
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
	click("discovery-rescan");
	expect(root.renderer.findByTestId("discovery-rail")).toBeUndefined();
	expect(root.renderer.getElementBounds(node("welcome-search").id)).toEqual(
		search
	);
	expect(scan.mock.calls[0]?.[1].aborted).toBe(true);
	pending.resolve({ ...progress, paths: ["/test/stale"] });
	await settle();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/stale")
	).toBeUndefined();
	scan.mockRejectedValueOnce(new Error("Scan failed"));
	click("discovery-rescan");
	await settle();
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain("Scan failed");
	scan.mockResolvedValueOnce(progress);
	click("discovery-rescan");
	await settle();
	expect(JSON.stringify(root.renderer.getA11yTree())).not.toContain(
		"Scan failed"
	);
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
	click("discovery-rescan");
	await settle();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
	root.unmount();
	expect(save.mock.calls.at(-1)?.[0].repositoryDiscovery).toEqual({
		folders: ["/Volumes/Work"],
		hidden: ["/test/discovered"],
	});
});

it("shows incomplete scans honestly and preserves layout at minimum size", async () => {
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
	expect(node("discovery-incomplete")).toBeDefined();
	const folder = root.renderer.getElementBounds(node("discovery-folder").id);
	const rescan = root.renderer.getElementBounds(node("discovery-rescan").id);

	const warning = root.renderer.getElementBounds(
		node("discovery-incomplete").id
	);

	const search = root.renderer.getElementBounds(node("welcome-search").id);
	const summary = root.renderer.getElementBounds(node("discovery-summary").id);

	if (!folder || !rescan || !warning || !search || !summary)
		throw new Error("Missing discovery layout");

	expect(folder.x + folder.width).toBeLessThan(summary.x);
	expect(summary.y).toBeGreaterThanOrEqual(search.y + search.height);
	expect(rescan.x).toBeGreaterThanOrEqual(summary.x);
	expect(rescan.x + rescan.width).toBeLessThanOrEqual(
		summary.x + summary.width
	);
	expect(warning.x).toBe(summary.x);
	expect(warning.x + warning.width).toBeLessThanOrEqual(
		summary.x + summary.width
	);
	expect(root.renderer.findByTestId("discovery-rail")).toBeUndefined();

	if (process.env.GPUIX_DISCOVERY_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DISCOVERY_SCREENSHOT);

	root.unmount();
	expect(scan).toHaveBeenCalledTimes(1);
});

it("keeps search and scan actions fixed when many suggestions scroll", async () => {
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
	const buttonBox = root.renderer.getElementBounds(node("discovery-folder").id);

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
	expect(root.renderer.getElementBounds(node("discovery-folder").id)).toEqual(
		buttonBox
	);
	expect(
		root.renderer.findByTestId("welcome-repository-/test/project-2999")
	).toBeUndefined();
	const visible = root.renderer.getListScrollTop(list.id)?.[0] ?? 0;

	root.renderer.nativeSimulateKeyDown(
		node(`welcome-repository-/test/project-${visible}`).id,
		"end"
	);
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
			`${process.env.GPUIX_DISCOVERY_SCREENSHOT}-dark.png`
		);
});

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
	click("welcome-view-starred");
	expect(node("welcome-repository-/Work/api")).toBeDefined();
	expect(root.renderer.findByTestId("welcome-back")).toBeUndefined();
	expect(scan).toHaveBeenCalledTimes(3);
	root.unmount();
	const document = save.mock.calls.at(-1)?.[0];

	expect(document?.repositoryLibrary).toEqual({
		starred: ["/Work/api"],
		view: "starred",
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
	click("welcome-view-listed");
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
	click("welcome-view-starred");
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

	const scan = mock<typeof RepositoryDiscovery.scan>(async ([folder]) =>
		folder === "/Volumes/Work" && !available
			? { ...progress, paths: [], scanned: 0, skipped: 1 }
			: {
					...progress,
					paths: folder === "/Volumes/Work" ? ["/Volumes/Work/api"] : [],
				}
	);

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
				repositoryLibrary: { starred: ["/Volumes/Work/api"], view: "listed" },
			}}
			discoverRepositories={scan}
			saveSession={save}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Folder unavailable");
	click("welcome-folder-/Volumes/Work");
	expect(node("welcome-repository-/Volumes/Work/api")).toBeDefined();
	available = true;
	click("welcome-folder-actions");
	await settle();
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
	click("welcome-view-starred");
	expect(node("welcome-repository-/Volumes/Work/api")).toBeDefined();
	root.unmount();
	const document = save.mock.calls.at(-1)?.[0];

	expect(document?.repositoryDiscovery).toBeUndefined();
	expect(document?.recentRepositories).toEqual(["/Volumes/Work/api"]);
	expect(document?.repositoryLibrary?.starred).toEqual(["/Volumes/Work/api"]);
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

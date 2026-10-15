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
import type {
	RepositoryDiscovery,
	RepositoryDiscoveryProgress,
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
	expect(
		node("welcome-repository-/test/discovered").customProps?.disabled
	).not.toBe(true);
	click("discovery-rescan");
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

it("scans additional folders with home, persists scope and removal, and ignores a cancelled picker", async () => {
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
	expect(scan.mock.calls.at(-1)?.[0]).toEqual([homedir(), "/Volumes/Work"]);
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

it("shows incomplete scans honestly, preserves layout at minimum size, and aborts on unmount", async () => {
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
	const box = root.renderer.getElementBounds(node("discovery-folder").id);

	expect(box?.width).toBeGreaterThan(100);

	if (process.env.GPUIX_DISCOVERY_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DISCOVERY_SCREENSHOT);

	root.unmount();
	expect(scan.mock.calls[0]?.[1].aborted).toBe(true);
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
	expect(scan.mock.calls.at(-1)?.[0]).toEqual([homedir(), "/Work"]);
	expect(
		root.renderer.findByTestId("welcome-repository-/test/discovered")
	).toBeUndefined();
});

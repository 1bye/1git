/**
 * Covers: welcome row hover/focus, list scrolling/removal, setup forms, picker intent, errors and cancellation.
 * Real: App, setup lifecycle, close/tab guards and GPUIX layout/events.
 * Doubles: Git setup/read, discovery cache, folder picker and inactive-window focus notifications; no writes/network.
 * Requires: patched native renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { App } from "../../src/app";
import type { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { windowOptions } from "../../src/window-options";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { RepositoryDiscoveryCache } from "../../src/feature/repository-discovery/repository-discovery-cache";
import { appThemes } from "../../src/styles/theme";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { rmSync } from "node:fs";

let root: TestRoot;
let f: ReturnType<typeof hostingRepositories>;
let originalAccountsPath: string | undefined;

beforeEach(() => {
	f = hostingRepositories();
	f.store.save([]);
	originalAccountsPath = process.env.GPUIX_ACCOUNTS_PATH;
	process.env.GPUIX_ACCOUNTS_PATH = f.store.path;
	root = createTestRoot({
		width: 980,
		height: 720,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();

	if (originalAccountsPath === undefined)
		delete process.env.GPUIX_ACCOUNTS_PATH;
	else process.env.GPUIX_ACCOUNTS_PATH = originalAccountsPath;

	rmSync(f.directory, { recursive: true, force: true });
});
const click = (id: string, button = 0) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	const bounds = root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateMouseMove(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
		button
	);
	root.renderer.flush();
};

it("uses a native repository menu for reveal, dismissal, forget and open", async () => {
	let choice = -1;
	const menu = mock(() => choice);

	const reveal = spyOn(
		RepositoryFileActions,
		"revealRepository"
	).mockResolvedValue(undefined);

	const reader = mock(readRepository);

	Object.assign(root.renderer, { showContextMenu: menu });
	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				recentRepositories: ["/test/project", "/test/other"],
			}}
			readRepository={reader}
		/>
	);
	await settle();
	click("welcome-view-list");
	click("welcome-folder-other");
	click("welcome-repository-/test/project", 2);
	await settle();
	expect(menu).toHaveBeenCalledWith(
		["Open", "Reveal in Finder", "Forget", "Star"],
		[true, true, true, true],
		expect.any(Number),
		expect.any(Number)
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	choice = 1;
	click("welcome-repository-/test/project", 2);
	await settle();
	expect(reveal).toHaveBeenCalledWith("/test/project");
	choice = 2;
	click("welcome-repository-/test/project", 2);
	await settle();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/project")
	).toBeUndefined();
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	choice = 0;
	click("welcome-repository-/test/other", 2);
	await settle();
	expect(reader).toHaveBeenLastCalledWith(
		"/test/other",
		expect.any(AbortSignal)
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("supports the keyboard repository menu and reports Finder errors", async () => {
	Object.assign(root.renderer, { showContextMenu: () => 1 });
	spyOn(RepositoryFileActions, "revealRepository").mockRejectedValue(
		new Error("Folder is unavailable.")
	);
	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				recentRepositories: ["/missing/project"],
			}}
		/>
	);
	await settle();
	click("welcome-view-list");
	click("welcome-folder-other");
	const row = root.renderer.findByTestId("welcome-repository-/missing/project");

	expect(row).toBeDefined();
	root.renderer.focusElement(row!.id);
	root.renderer.simulateKeystrokes("shift-f10");
	await settle();
	expect(root.renderer.getAllText()).toContain("Folder is unavailable.");
	expect(
		root.renderer.findByTestId("welcome-repository-/missing/project")
	).toBeDefined();
});

const settle = async () => {
	root.renderer.flush();
	await Bun.sleep(120);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(0);
	root.renderer.flush();
};

const readRepository = async () => ({
	ok: true as const,
	value: repositorySnapshot([]),
});

for (const appearance of ["light", "dark"] as const) {
	it(`highlights the complete repository row across controls and keyboard focus in ${appearance} mode`, async () => {
		root.render(
			<App
				initialSession={{
					version: 1,
					appearance,
					tabs: [],
					activeId: null,
					recentRepositories: ["/test/project", "/test/other"],
				}}
			/>
		);
		await settle();
		click("welcome-view-list");
		click("welcome-folder-other");
		click("welcome-search");
		root.renderer.nativeSimulateMouseMove(0, 0);
		root.renderer.flush();
		const action = () =>
			root.renderer.findByTestId("welcome-forget-/test/project");

		const group = () =>
			root.renderer.findByTestId("welcome-row-/test/project")!;

		const row = root.renderer.findByTestId("welcome-repository-/test/project");
		const remove = action();
		const search = root.renderer.findByTestId("welcome-search");
		const rowBounds = row && root.renderer.getElementBounds(row.id);
		const removeBounds = remove && root.renderer.getElementBounds(remove.id);

		if (!row || !remove || !search || !rowBounds || !removeBounds)
			throw new Error("Missing hover controls");

		expect(action()?.style.opacity).toBe(0);
		expect(group().style.backgroundColor).toBe("transparent");
		expect(row.style.hover).toMatchObject({ backgroundColor: "transparent" });
		expect(root.renderer.getAllText()).not.toContain("Remove");
		const icon = root.renderer.findByTestId(
			"welcome-forget-icon-/test/project"
		);

		expect(icon?.customProps?.source).toContain("M234.62,218.6");
		expect(icon?.style.color).toBe(
			appThemes[appearance].tokens.colors.textMuted
		);
		expect(remove.customProps?.["aria-label"]).toBe(
			"Remove /test/project from list"
		);
		expect(remove.customProps?.["aria-description"]).toBe(
			"Removes only the saved entry. Your repository folder is kept."
		);

		for (const [x, y] of [
			[rowBounds.x + 20, rowBounds.y + 20],
			[rowBounds.x + rowBounds.width + 2, rowBounds.y + 20],
			[removeBounds.x + 13, removeBounds.y + 13],
		] as const) {
			root.renderer.nativeSimulateMouseMove(x, y);
			root.renderer.flush();
			expect(action()?.style.opacity).toBe(1);
			expect(group().style.backgroundColor).toBe(
				appThemes[appearance].tokens.colors.surface
			);
		}

		const groupBounds = root.renderer.getElementBounds(group().id)!;

		expect(removeBounds.x + removeBounds.width).toBeLessThanOrEqual(
			groupBounds.x + groupBounds.width
		);

		if (process.env.GPUIX_WELCOME_HOVER_SCREENSHOT) {
			await Bun.sleep(100);
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_WELCOME_HOVER_SCREENSHOT}.${appearance}.png`
			);
		}

		root.renderer.nativeSimulateMouseMove(300, 500);
		root.renderer.flush();
		expect(action()?.style.opacity).toBe(0);
		expect(group().style.backgroundColor).toBe("transparent");
		// Offscreen test windows are inactive; deliver native focus notifications explicitly.
		flushSync(() =>
			handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
		);
		expect(action()?.style.opacity).toBe(1);
		expect(group().style.backgroundColor).toBe(
			appThemes[appearance].tokens.colors.surface
		);
		flushSync(() => {
			handleGpuixEvent(
				{ elementId: remove.id, eventType: "focus" },
				root.renderer
			);
			handleGpuixEvent({ elementId: row.id, eventType: "blur" }, root.renderer);
		});
		expect(action()?.style.opacity).toBe(1);
		flushSync(() =>
			handleGpuixEvent(
				{ elementId: remove.id, eventType: "blur" },
				root.renderer
			)
		);
		expect(action()?.style.opacity).toBe(0);
		expect(group().style.backgroundColor).toBe("transparent");
	});
}

it("removes only the saved repository entry and persists the updated list", async () => {
	const reader = mock(readRepository);
	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				appearance: "dark",
				recentRepositories: ["/test/project", "/test/other"],
			}}
			readRepository={reader}
			saveSession={save}
		/>
	);
	await settle();
	click("welcome-view-list");
	click("welcome-folder-other");
	expect(
		root.renderer.findByTestId("welcome-forget-icon-/test/project")?.style.color
	).toBe(appThemes.dark.tokens.colors.textMuted);
	click("welcome-forget-/test/project");
	await settle();

	expect(
		root.renderer.findByTestId("welcome-repository-/test/project")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/other")
	).toBeDefined();
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	await Bun.sleep(220);
	expect(save.mock.calls.at(-1)?.[0]).toEqual(
		expect.objectContaining({ recentRepositories: ["/test/other"] })
	);
	const remove = root.renderer.findByTestId("welcome-forget-/test/other");

	if (!remove) throw new Error("Missing keyboard removal action");

	root.renderer.focusElement(remove.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(root.renderer.getAllText()).toContain("No repositories yet");
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
});

it("scrolls only the repository list while quick actions and search stay fixed", async () => {
	root.unmount();
	root = createTestRoot({ width: 980, height: 640 });
	root.renderer.clockPause();

	const paths = Array.from(
		{ length: 100 },
		(_, index) => `/test/project-${index}`
	);

	const longPath = `/test/${"long-parent-directory/".repeat(10)}${"long-repository-name-".repeat(8)}`;

	paths[0] = longPath;

	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				recentRepositories: paths,
			}}
		/>
	);
	await settle();
	click("welcome-view-list");
	click("welcome-folder-other");
	const list = root.renderer.findByTestId("welcome-repositories");
	const search = root.renderer.findByTestId("welcome-search");
	const open = root.renderer.findByTestId("open-repository");
	const page = root.renderer.findByTestId("repository-welcome");

	if (!list || !search || !open || !page)
		throw new Error("Missing welcome layout");

	const searchBefore = root.renderer.getElementBounds(search.id);
	const openBefore = root.renderer.getElementBounds(open.id);
	const viewport = root.renderer.findByTestId("welcome-repositories-viewport");
	const listBounds = viewport && root.renderer.getElementBounds(viewport.id);
	const pageBefore = root.renderer.getScrollOffset(page.id);

	if (!listBounds) throw new Error("Missing list bounds");

	expect(listBounds.y + listBounds.height).toBeLessThanOrEqual(640);
	const remove = root.renderer.findByTestId(`welcome-forget-${longPath}`);
	const removeBounds = remove && root.renderer.getElementBounds(remove.id);

	if (!removeBounds) throw new Error("Missing long-path removal action");

	for (const field of ["name", "path"]) {
		const text = root.renderer.findByTestId(`welcome-${field}-${longPath}`);
		const textBounds = text && root.renderer.getElementBounds(text.id);

		if (!textBounds) throw new Error(`Missing repository ${field}`);

		expect(textBounds.width).toBeGreaterThan(0);
		expect(textBounds.x + textBounds.width).toBeLessThanOrEqual(removeBounds.x);
		expect(textBounds.height).toBeLessThan(24);
	}

	if (process.env.GPUIX_WELCOME_SCREENSHOT) {
		root.renderer.advanceTime(1);
		root.renderer.flush();
		await Bun.sleep(100);
		root.renderer.captureScreenshot(process.env.GPUIX_WELCOME_SCREENSHOT);
	}

	root.renderer.nativeSimulateScrollWheel(
		listBounds.x + 20,
		listBounds.y + 20,
		0,
		-480
	);
	root.renderer.flush();

	expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-300);
	expect(root.renderer.getScrollOffset(page.id)).toEqual(pageBefore);
	expect(root.renderer.getElementBounds(search.id)).toEqual(searchBefore);
	expect(root.renderer.getElementBounds(open.id)).toEqual(openBefore);
	root.renderer.scrollToItem(list.id, paths.length - 1, 0);
	await settle();
	const last = root.renderer.findByTestId("welcome-forget-/test/project-99");
	const lastBounds = last && root.renderer.getElementBounds(last.id);

	if (!lastBounds) throw new Error("Final repository action is not visible");

	expect(lastBounds.y).toBeGreaterThanOrEqual(listBounds.y);
	expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
		listBounds.y + listBounds.height
	);
	click("welcome-forget-/test/project-99");
	await settle();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/project-99")
	).toBeUndefined();
});

it("creates from the compact form and opens Changes after success", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: true,
		path: "/test/project",
	}));

	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([
		"/test/project",
	]);

	root.render(<App setupRepository={setup} readRepository={readRepository} />);
	expect(root.renderer.getAllText()).toContain("QUICK ACTIONS");
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	expect(picker).toHaveBeenCalledWith(
		expect.objectContaining({ directories: true, files: false })
	);
	expect(setup).not.toHaveBeenCalled();
	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledWith(
		{ kind: "create", path: "/test/project", branch: "main" },
		expect.any(AbortSignal)
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
	expect(root.renderer.findByTestId("repository-create")).toBeUndefined();
});

it("keeps errors and offers Open for existing repositories without another write", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: false,
		message: "This folder is already a repository.",
		openPath: "/test/project",
	}));

	const read = mock(readRepository);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(<App setupRepository={setup} readRepository={read} />);
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	click("setup-submit");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"This folder is already a repository."
	);
	expect(read).not.toHaveBeenCalled();
	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalledWith("/test/project", expect.any(AbortSignal));
});

it("cancels a clone, waits for Git settlement and preserves its form for retry", async () => {
	const cache = new RepositoryDiscoveryCache("/unused/discovery-cache");
	const remember = spyOn(cache, "remember").mockImplementation(() => {});
	let blocked = false;

	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	let finish: (() => void) | undefined;
	let operationSignal: AbortSignal | undefined;

	const setup = mock<typeof RepositorySetup.write>(async (_request, signal) => {
		operationSignal = signal;
		await new Promise<void>((resolve) => {
			finish = resolve;
		});

		return {
			ok: false,
			message: "Operation cancelled. Review the destination before retrying.",
		};
	});

	root.render(<App setupRepository={setup} discoveryCache={cache} />);
	click("repository-clone");
	await settle();
	click("setup-url");
	root.renderer.simulateKeystrokes("r e p o . g i t");
	root.renderer.flush();
	click("setup-submit");
	await settle();
	expect(root.renderer.getAllText()).toContain("Cloning repository…");
	expect(blocked).toBe(true);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	click("close-workspace-1");
	await settle();
	expect(root.renderer.findByTestId("repository-clone-view")).toBeDefined();
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	click("setup-cancel");
	await settle();
	expect(operationSignal?.aborted).toBe(true);
	expect(root.renderer.getAllText()).toContain("Stopping…");
	expect(blocked).toBe(true);
	finish?.();
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Operation cancelled. Review the destination before retrying."
	);
	expect(root.renderer.findByTestId("setup-url")).toBeDefined();
	expect(setup).toHaveBeenCalledTimes(1);
	expect(blocked).toBe(false);
	expect(remember).not.toHaveBeenCalled();
});

it("offers Open after a successful write whose read fails, without recreating", async () => {
	const cache = new RepositoryDiscoveryCache("/unused/discovery-cache");
	const remember = spyOn(cache, "remember").mockImplementation(() => {});

	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: true,
		path: "/test/project",
	}));

	let reads = 0;

	const reader = async () => {
		reads++;

		if (reads === 1) throw new Error("Read temporarily unavailable");

		return readRepository();
	};

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App
			setupRepository={setup}
			readRepository={reader}
			discoveryCache={cache}
		/>
	);
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	click("setup-submit");
	await settle();
	expect(root.renderer.findByTestId("setup-error")).toBeDefined();
	expect(remember).toHaveBeenCalledWith("/test/project");
	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledTimes(1);
	expect(reads).toBe(2);
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("dismisses with Escape without writing and restores trigger focus", async () => {
	const setup = mock<typeof RepositorySetup.write>();

	root.render(<App setupRepository={setup} />);
	click("repository-clone");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(setup).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("setup-url")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("repository-clone")?.id ?? null
	);
});

it("shows the desktop-style page with no tabs and keeps the setup form when it opens a tab", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: true,
		path: "/test/project",
	}));

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App
			initialSession={{ version: 1, tabs: [], activeId: null }}
			setupRepository={setup}
			readRepository={readRepository}
		/>
	);
	expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("ALL REPOSITORIES");
	expect(root.renderer.findByTestId("welcome-search-control")).toBeDefined();
	click("repository-create");
	await settle();
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	expect(root.renderer.findByTestId("setup-branch")).toBeDefined();
	click("setup-location");
	await settle();
	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("searches remembered repositories after closing all tabs and reopens without the picker", async () => {
	const reader = mock(readRepository);
	const picker = spyOn(root.renderer, "promptForPaths");

	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
				activeId: "workspace-1",
			}}
			readRepository={reader}
		/>
	);
	await settle();
	click("close-workspace-1");
	await settle();
	expect(root.renderer.findByTestId("repository-welcome")).toBeDefined();
	click("welcome-search");
	root.renderer.simulateKeystrokes("z z z");
	root.renderer.flush();
	expect(
		root.renderer.findByTestId("welcome-repository-/test/project")
	).toBeUndefined();
	root.renderer.simulateKeystrokes("cmd-a backspace");
	root.renderer.flush();
	click("welcome-view-list");
	click("welcome-folder-other");
	await settle();
	const readsBeforeOpening = reader.mock.calls.length;

	click("welcome-repository-/test/project");
	await settle();
	expect(reader).toHaveBeenCalledTimes(readsBeforeOpening + 1);
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

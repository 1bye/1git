/**
 * Covers: setup forms, native picker intent, success, errors, retry/open and cancellation.
 * Real: App, setup lifecycle, close/tab guards and GPUIX layout/events.
 * Doubles: Git setup/read and native folder picker; no filesystem writes or network.
 * Requires: patched native renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";
import { windowOptions } from "../../src/window-options";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

beforeEach(() => {
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
});
const click = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	const bounds = root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
};

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

	root.render(<App setupRepository={setup} />);
	click("repository-clone");
	await settle();
	click("setup-url");
	root.renderer.simulateKeystrokes("r e p o . g i t");
	root.renderer.flush();
	click("setup-submit");
	await settle();
	expect(root.renderer.getAllText()).toContain("Cloning repository…");
	expect(blocked).toBe(true);
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
});

it("offers Open after a successful write whose read fails, without recreating", async () => {
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
	root.render(<App setupRepository={setup} readRepository={reader} />);
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	click("setup-submit");
	await settle();
	expect(root.renderer.findByTestId("setup-error")).toBeDefined();
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
	expect(root.renderer.getAllText()).toContain("ALL REPOSITORIES");
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
	click("welcome-repository-/test/project");
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

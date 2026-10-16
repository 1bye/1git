/**
 * Covers: creating, cloning and opening remote repositories, folder selection and worktrees through existing forms.
 * Real: App, machine-aware paths, workspace coordination and native GPUIX layout/input.
 * Doubles: SSH, account storage, discovery and Git boundaries; no user folders or network.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { Machines } from "../../src/feature/machines/machines";
import { MachineStore } from "../../src/feature/machines/machine-store";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { SshConnection } from "../../src/feature/machines/ssh-connection";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import type { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";
import type { RepositoryWorktrees } from "../../src/feature/workspace-tabs/lib/repository-worktrees";
import type { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

const machine = {
	id: "00000000-0000-4000-8000-000000000001",
	name: "Devbox",
	host: "devbox",
	username: "",
	port: null,
	identityFile: "",
	folders: [],
} as const;

const location = (path: string) => MachineLocation.encode(machine.id, path);
let root: TestRoot;

function fixture() {
	const machines = new Machines(new MachineStore("/unused/machines.json"));

	const accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			return null;
		},
		async write() {},
		async delete() {},
	});

	spyOn(machines, "list").mockReturnValue([machine]);
	spyOn(machines, "home").mockReturnValue("/remote/home");
	spyOn(machines, "listDirectory").mockImplementation(async (path) => ({
		path,
		parent: location("/remote/home"),
		entries:
			path === location("/remote/home")
				? [{ name: "projects", path: location("/remote/home/projects") }]
				: [],
		limited: false,
	}));
	spyOn(machines, "state").mockReturnValue({ status: "Connected" });
	spyOn(machines, "connect").mockResolvedValue(
		new SshConnection(
			machine,
			async () => null,
			() => undefined
		)
	);
	spyOn(machines, "scan").mockResolvedValue({
		paths: [],
		scanned: 0,
		skipped: 0,
		limited: false,
	});
	spyOn(accounts, "load").mockReturnValue([]);

	return { machines, accounts };
}

const snapshot = (path: string) => {
	const base = repositorySnapshot([changedFile("file.txt")]);

	return {
		...base,
		repository: {
			...base.repository,
			root: path,
			gitDirectory: location("/remote/home/repo/.git"),
			commonDirectory: location("/remote/home/repo/.git"),
		},
		head: { ...base.head, branch: path.endsWith("topic") ? "topic" : "main" },
	};
};

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

function click(id: string) {
	const box = root.renderer.getElementBounds(node(id).id)!;

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}

function enter(id: string, text: string) {
	click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...text].join(" "));
	root.renderer.flush();
}

async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(10);
		root.renderer.clockFastForward(150);
		root.renderer.flush();
	}

	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

it("clones on the selected machine, validates its destination and opens the result without the Mac folder picker", async () => {
	const setup = mock<typeof RepositorySetup.write>(async (request) => ({
		ok: true,
		path: request.path,
	}));

	const picker = spyOn(root.renderer, "promptForPaths");

	root.render(
		<App
			{...fixture()}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				repositoryLibrary: { machine: machine.id, view: "tiles", starred: [] },
			}}
			setupRepository={setup}
			readRepository={async (path) => ({ ok: true, value: snapshot(path) })}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	expect(root.renderer.findByTestId("repository-create")).toBeDefined();
	click("repository-clone");
	await settle();
	expect(root.renderer.getAllText()).toContain("Clone on Devbox");
	expect(root.renderer.findByTestId("setup-location")).toBeUndefined();
	enter("setup-url", "git@example.invalid:team/repo.git");
	expect(node("setup-remote-location").customProps?.value).toBe(
		"/remote/home/repo"
	);
	enter("setup-remote-location", "relative");
	click("setup-submit");
	await settle();
	expect(setup).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain(
		"Enter an absolute folder path on this machine."
	);
	enter("setup-remote-location", "/remote/home/projects/repo");
	click("clone-browse-remote");
	await settle();
	expect(node("remote-folder-path").customProps?.value).toBe(
		"/remote/home/projects"
	);
	click("remote-folder-select");
	await settle();
	expect(setup).not.toHaveBeenCalled();
	const screenshot = process.env.GPUIX_SSH_WORKFLOWS_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.clone.png`);

	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledWith(
		{
			kind: "clone",
			path: location("/remote/home/projects/repo"),
			remoteUrl: "git@example.invalid:team/repo.git",
		},
		expect.any(AbortSignal)
	);
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
	expect(node("workspace-1").customProps?.["aria-label"]).toContain("Devbox");
});

it("creates and opens a remote worktree with a machine-qualified destination while preserving the original draft", async () => {
	const path = location("/remote/home/repo");
	const worktree = location("/remote/home/repo-topic");
	const base = snapshot(path);

	const writeWorktree = mock<typeof RepositoryWorktrees.create>(
		async (_root, request) => ({ ok: true, value: request.path })
	);

	const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
		ok: true,
		value: {
			branches: { branches: [], current: "main" },
			savedChanges: [],
			remotes: [],
			worktrees: [],
		},
	}));

	const picker = spyOn(root.renderer, "promptForPaths");

	root.render(
		<App
			{...fixture()}
			initialSession={{
				version: 1,
				tabs: [{ id: "workspace-1", path, draft: "Keep this draft" }],
				activeId: "workspace-1",
			}}
			readRepository={async (target) => ({ ok: true, value: snapshot(target) })}
			readBranches={readBranches}
			writeWorktree={writeWorktree}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click("workspace-1");
	await settle();
	click("new-actions");
	await settle();
	click("create-worktree");
	await settle();
	enter("worktree-branch-name", "topic");
	await settle();
	expect(root.renderer.getAllText()).toContain("Location on Devbox");
	expect(node("worktree-remote-location").customProps?.value).toBe(
		"/remote/home/repo-topic"
	);
	expect(
		root.renderer.findByTestId("worktree-change-location")
	).toBeUndefined();
	const screenshot = process.env.GPUIX_SSH_WORKFLOWS_SCREENSHOT;

	click("worktree-browse-remote");
	await settle();
	click("remote-folder-select");
	await settle();
	expect(writeWorktree).not.toHaveBeenCalled();

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}.worktree.png`);

	click("confirm-create-worktree");
	await settle();
	expect(writeWorktree).toHaveBeenCalledWith(path, {
		kind: "new",
		branch: "topic",
		path: worktree,
		expectedHead: base.head.oid,
		expectedBranch: "main",
	});
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("workspace-2")).toBeDefined();
	click("workspace-1");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Keep this draft");
});

it("creates a repository in a new folder selected through the remote browser only after the final Create action", async () => {
	const setup = mock<typeof RepositorySetup.write>(async (request) => ({
		ok: true,
		path: request.path,
	}));

	const picker = spyOn(root.renderer, "promptForPaths");

	root.render(
		<App
			{...fixture()}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				repositoryLibrary: { machine: machine.id, view: "tiles", starred: [] },
			}}
			setupRepository={setup}
			readRepository={async (path) => ({ ok: true, value: snapshot(path) })}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	click("remote-folder-projects");
	await settle();
	enter("remote-folder-name", "new-repository");
	const screenshot = process.env.GPUIX_SSH_WORKFLOWS_SCREENSHOT;

	if (screenshot)
		root.renderer.captureScreenshot(`${screenshot}.create-browser.png`);

	click("remote-folder-select");
	await settle();
	expect(setup).not.toHaveBeenCalled();
	expect(root.renderer.getAllText()).toContain(
		"/remote/home/projects/new-repository"
	);
	click("setup-submit");
	await settle();
	expect(setup).toHaveBeenCalledWith(
		{
			kind: "create",
			path: location("/remote/home/projects/new-repository"),
			branch: "main",
		},
		expect.any(AbortSignal)
	);
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("opens a remote repository from the folder browser and cancelling it creates no workspace", async () => {
	const read = mock(async (path: string) => ({
		ok: true as const,
		value: snapshot(path),
	}));

	const setup = mock<typeof RepositorySetup.write>();
	const picker = spyOn(root.renderer, "promptForPaths");

	root.render(
		<App
			{...fixture()}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				repositoryLibrary: { machine: machine.id, view: "tiles", starred: [] },
			}}
			setupRepository={setup}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click("open-repository");
	await settle();
	click("remote-folder-cancel");
	await settle();
	expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
	expect(read).not.toHaveBeenCalled();
	click("open-repository");
	await settle();
	click("remote-folder-projects");
	await settle();
	expect(root.renderer.findByTestId("remote-folder-name")).toBeUndefined();
	click("remote-folder-select");
	await settle();
	expect(read).toHaveBeenCalledWith(
		location("/remote/home/projects"),
		expect.any(AbortSignal)
	);
	expect(setup).not.toHaveBeenCalled();
	expect(picker).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("clears the creation destination when switching from a remote machine to This Mac", async () => {
	const setup = mock<typeof RepositorySetup.write>();

	root.render(
		<App
			{...fixture()}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				repositoryLibrary: { machine: machine.id, view: "tiles", starred: [] },
			}}
			setupRepository={setup}
		/>
	);
	await settle();
	click("repository-create");
	await settle();
	click("setup-location");
	await settle();
	enter("remote-folder-name", "new-repo");
	click("remote-folder-select");
	await settle();
	click("setup-cancel");
	await Bun.sleep(150);
	await settle();
	click("machine-local");
	await settle();
	expect(root.renderer.getAllText()).toContain("Open from disk");
	click("repository-create");
	await settle();
	expect(node("setup-location").customProps?.["aria-label"]).toBe(
		"Choose repository folder"
	);
	click("setup-submit");
	await settle();
	expect(setup).not.toHaveBeenCalled();
});

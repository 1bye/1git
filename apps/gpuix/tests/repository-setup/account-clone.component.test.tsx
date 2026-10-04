/**
 * Covers: native account/repository selection, search, pagination, reset, permissions, Settings entry and clone submission.
 * Real: App, account service, provider transport and native GPUIX layout/events.
 * Doubles: provider HTTP/vault, folder picker and Git setup/read; no live account or project.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import type { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";

let root: TestRoot;
let f: ReturnType<typeof hostingRepositories>;

beforeEach(() => {
	f = hostingRepositories();
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
	rmSync(f.directory, { recursive: true, force: true });
});
function click(id: string) {
	const element = root.renderer.findByTestId(id);
	const bounds = element && root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
}
async function settle() {
	root.renderer.flush();
	await Bun.sleep(170);
	root.renderer.clockFastForward(200);
	root.renderer.advanceTime(1);
	root.renderer.flush();
}
async function browse() {
	click("repository-clone");
	await settle();
}

it("selects an account repository, pages results, picks a folder and opens after clone", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: true,
		path: "/test/project",
	}));

	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([
		"/test/project",
	]);

	root.render(
		<App
			accounts={f.accounts}
			setupRepository={setup}
			readRepository={async () => ({ ok: true, value: repositorySnapshot([]) })}
		/>
	);
	await browse();
	expect(root.renderer.getAllText().join("")).toContain("tester/project");
	expect(root.renderer.getAllText()).not.toContain("fixture-github-token");
	click("setup-submit");
	expect(setup).not.toHaveBeenCalled();
	click("clone-more");
	await settle();
	expect(root.renderer.getAllText().join("")).toContain("tester/other");
	click("clone-repository-10");
	const name = root.renderer.findByTestId("clone-repository-name-10");

	const description = root.renderer.findByTestId(
		"clone-repository-description-10"
	);

	const nameBounds = name && root.renderer.getElementBounds(name.id);

	const descriptionBounds =
		description && root.renderer.getElementBounds(description.id);

	expect(nameBounds).toBeDefined();
	expect(descriptionBounds).toBeDefined();

	if (nameBounds && descriptionBounds)
		expect(descriptionBounds.y).toBeGreaterThanOrEqual(
			nameBounds.y + nameBounds.height
		);

	click("setup-location");
	await settle();

	if (process.env.GPUIX_CLONE_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_CLONE_SCREENSHOT);

	click("setup-submit");
	await settle();
	expect(picker).toHaveBeenCalledWith(
		expect.objectContaining({
			files: false,
			directories: true,
			multiple: false,
		})
	);
	expect(setup).toHaveBeenCalledWith(
		{
			kind: "clone",
			path: "/test/project",
			remoteUrl: "https://github.com/tester/project.git",
			source: {
				account: f.saved[0],
				repository: { owner: "tester", name: "project" },
			},
		},
		expect.any(AbortSignal)
	);
	expect(root.renderer.findByTestId("commit-composer")).toBeDefined();
});

it("search and account changes clear the selected repository before cloning", async () => {
	const setup = mock<typeof RepositorySetup.write>();

	root.render(<App accounts={f.accounts} setupRepository={setup} />);
	await browse();
	click("clone-repository-10");
	click("clone-search");
	root.renderer.simulateKeystrokes("m i s s i n g");
	root.renderer.flush();
	click("setup-submit");
	expect(setup).not.toHaveBeenCalled();
	await Bun.sleep(350);
	await settle();
	expect(root.renderer.getAllText()).toContain("No repositories found.");
	expect(root.renderer.findByTestId("state-art-search")).toBeDefined();
	click("clone-search");
	root.renderer.simulateKeystrokes("cmd-a backspace");
	await settle();
	click("clone-repository-10");
	click("clone-account-8");
	await settle();
	expect(root.renderer.getAllText().join("")).toContain(
		"group/nested/lab-project"
	);
	click("setup-submit");
	expect(setup).not.toHaveBeenCalled();
	click("setup-cancel");
	await settle();
	expect(root.renderer.findByTestId("clone-account-picker")).toBeUndefined();
});

it("handles safe permission errors, retries, and shows settings when no account exists", async () => {
	f.status(403);
	root.render(<App accounts={f.accounts} />);
	await browse();
	expect(root.renderer.getAllText().join("")).toContain("repository access");
	expect(root.renderer.findByTestId("state-art-error")).toBeDefined();
	expect(root.renderer.getAllText()).not.toContain(
		"never-display-provider-secret"
	);
	f.status(200);
	click("clone-retry");
	await settle();
	expect(root.renderer.getAllText().join("")).toContain("tester/project");
	click("setup-cancel");
	await settle();
	f.store.save([]);
	await browse();
	expect(root.renderer.getAllText().join("")).toContain("Repository URL");
	click("clone-settings");
	await settle();
	expect(root.renderer.findByTestId("accounts-settings")).toBeDefined();
	expect(root.renderer.findByTestId("clone-account-picker")).toBeUndefined();
	click("settings-back");
	await settle();
	expect(root.renderer.findByTestId("repository-clone-view")).toBeDefined();
});

it("cancels pending browsing on dismissal and ignores stale provider responses", async () => {
	let resolve: ((response: Response) => void) | undefined;

	const requests = spyOn(f.accounts, "repositories").mockImplementation(
		async (_account, _query, options) => {
			await new Promise<Response>((finish) => {
				resolve = finish;
			});
			expect(options?.signal?.aborted).toBe(true);

			return { items: [], next: null, rateLimit: {} };
		}
	);

	root.render(<App accounts={f.accounts} />);
	await browse();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	resolve?.(new Response());
	await settle();
	expect(requests).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("clone-account-picker")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("repository-clone")?.id ?? null
	);
});

it("retains the account and selected repository after a failed clone and supports keyboard retry", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: false,
		message: "Clone did not finish. Review the destination before retrying.",
	}));

	root.render(<App accounts={f.accounts} setupRepository={setup} />);
	await browse();
	click("clone-account-8");
	await settle();
	const repository = root.renderer.findByTestId("clone-repository-20");

	expect(repository).toBeDefined();

	if (!repository) throw new Error("Missing GitLab repository");

	root.renderer.focusElement(repository.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected repository"
	);
	click("setup-submit");
	await settle();
	expect(root.renderer.getAllText().join("")).toContain("Clone did not finish");
	expect(root.renderer.getAllText().join("")).toContain("lab-user");
	expect(root.renderer.findByTestId("clone-repository-20")).toBeDefined();
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected repository"
	);
	const retry = root.renderer.findByTestId("setup-submit");

	if (!retry) throw new Error("Missing retry action");

	root.renderer.focusElement(retry.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(setup).toHaveBeenCalledTimes(2);
	expect(setup.mock.calls[0]?.[0]).toEqual(setup.mock.calls[1]?.[0]);
	expect(setup.mock.calls[1]?.[0]).toMatchObject({
		source: {
			account: f.saved[1],
			repository: { owner: "group/nested", name: "lab-project" },
		},
	});
});

it("keeps clone actions within the viewport at minimum window height", async () => {
	root.unmount();
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	root.render(<App accounts={f.accounts} />);
	await browse();
	click("clone-repository-10");
	await settle();

	for (const id of ["setup-cancel", "setup-submit"]) {
		const element = root.renderer.findByTestId(id);
		const bounds = element && root.renderer.getElementBounds(element.id);

		expect(bounds).toBeDefined();

		if (!bounds) throw new Error(`Missing action ${id}`);

		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
	}
});

it("replaces the welcome page in the same tab and keeps its footer fixed while scrolling", async () => {
	const account = f.saved[0];

	if (!account) throw new Error("Missing account fixture");

	const page = await f.accounts.repositories(account, "", { pageSize: 30 });
	const template = page.items[0];

	if (!template) throw new Error("Missing repository fixture");

	spyOn(f.accounts, "repositories").mockResolvedValue({
		...page,
		next: null,
		items: Array.from({ length: 30 }, (_, index) => ({
			...template,
			id: String(100 + index),
			ref: { owner: "tester", name: `project-${index}` },
		})),
	});
	root.render(<App accounts={f.accounts} />);
	await browse();

	expect(root.renderer.findByTestId("repository-welcome")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	const list = root.renderer.findByTestId("clone-repositories");
	const footer = root.renderer.findByTestId("clone-footer");

	if (!list || !footer) throw new Error("Missing clone layout");

	const before = root.renderer.getElementBounds(footer.id);

	root.renderer.scrollTo(list.id, 0, -500);
	await settle();

	expect(root.renderer.getElementBounds(footer.id)).toEqual(before);
	click("clone-back");
	await settle();
	expect(root.renderer.findByTestId("repository-welcome")).toBeDefined();
	expect(root.renderer.findByTestId("repository-clone-view")).toBeUndefined();
});

it("keeps its selection across access settings and tab switches, and routes search to the visible view", async () => {
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: false,
		message: "Try again.",
	}));

	root.render(
		<App initialTabCount={2} accounts={f.accounts} setupRepository={setup} />
	);
	await browse();
	click("clone-account-8");
	await settle();
	click("clone-repository-20");
	click("clone-permissions");
	await settle();
	expect(root.renderer.getAllText().join("")).toContain(
		"Missing a private repository?"
	);
	click("clone-manage-access");
	await settle();
	expect(root.renderer.findByTestId("accounts-settings")).toBeDefined();
	click("settings-back");
	await settle();
	root.renderer.simulateKeystrokes("cmd-2");
	await settle();
	expect(root.renderer.findByTestId("repository-welcome")).toBeDefined();
	root.renderer.simulateKeystrokes("cmd-1");
	await settle();
	root.renderer.simulateKeystrokes("cmd-f");
	await settle();

	expect(root.renderer.getFocusedElementId()).toBe(
		root.renderer.findByTestId("clone-search")?.id ?? null
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected repository"
	);
	click("setup-submit");
	await settle();
	expect(setup.mock.calls[0]?.[0]).toMatchObject({
		source: {
			account: f.saved[1],
			repository: { owner: "group/nested", name: "lab-project" },
		},
	});
});

it("returns from Add account with freshly saved accounts without losing the URL draft", async () => {
	f.store.save([]);
	const setup = mock<typeof RepositorySetup.write>(async () => ({
		ok: false,
		message: "Try again.",
	}));

	root.render(
		<App
			initialSession={{ version: 1, tabs: [], activeId: null }}
			accounts={f.accounts}
			setupRepository={setup}
		/>
	);
	await browse();
	click("setup-url");
	root.renderer.simulateKeystrokes("r e p o . g i t");
	root.renderer.flush();
	click("clone-settings");
	await settle();
	expect(root.renderer.findByTestId("account-provider-github")).toBeDefined();
	const account = f.saved[1];

	if (!account) throw new Error("Missing account fixture");

	f.store.save([account]);
	click("settings-back");
	await settle();

	expect(root.renderer.findByTestId("clone-account-8")).toBeDefined();
	expect(root.renderer.findByTestId("workspace-1")).toBeDefined();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	click("setup-submit");
	await settle();
	expect(setup.mock.calls[0]?.[0]).toMatchObject({
		kind: "clone",
		remoteUrl: "repo.git",
	});
	click("clone-account-8");
	await settle();
	expect(root.renderer.findByTestId("clone-repository-20")).toBeDefined();
});

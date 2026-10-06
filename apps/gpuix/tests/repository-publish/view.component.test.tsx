/**
 * Covers: publishing entry points, right-side layout, private defaults, account/owner choices, retry and operation locking.
 * Real: App/form/reducers, native controls, focus and layout.
 * Doubles: account catalog/owners, Git reads and publishing transaction; no network or real accounts.
 * Requires: built native addon and graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";
import {
	RepositoryPublish,
	type PublishRepositoryRequest,
	type PublishedRepository,
} from "../../src/feature/repository-publish/repository-publish";
import { RepositoryPublishView } from "../../src/feature/repository-publish/repository-publish-view";
import { App } from "../../src/app";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";
import type { Page, Owner } from "@1git/hosting/contracts";
import type { GitResult, SyncResult } from "@1git/git";

const alice: SavedAccount = {
	provider: "github",
	id: "7",
	username: "alice",
	webUrl: "https://github.com/",
};

const bob: SavedAccount = {
	provider: "gitlab",
	id: "8",
	username: "bob",
	webUrl: "https://gitlab.com/",
};

const owner = {
	id: "7",
	path: "alice",
	kind: "user" as const,
	canCreateRepository: null,
};

const receipt: PublishedRepository = {
	id: "88",
	ref: { owner: "alice", name: "project" },
	visibility: "private",
	accountKey: AccountStore.key(alice),
	commonDirectory: "/test/project/.git",
	head: "1234567890abcdef",
	branch: "main",
};

const failed: GitResult<SyncResult> = {
	ok: false,
	error: {
		code: "command-failed",
		operation: "push",
		message: "Push denied",
		retryable: true,
	},
};

const success: GitResult<SyncResult> = {
	ok: true,
	value: {
		operation: "push",
		remote: "origin",
		branch: "main",
		snapshot: repositorySnapshot(),
	},
};

let root: TestRoot;
let accounts: Accounts;

beforeEach(() => {
	root = createTestRoot({
		width: 1050,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			throw new Error("No vault reads expected");
		},
		async write() {},
		async delete() {},
	});
	spyOn(accounts, "load").mockReturnValue([alice, bob]);
	spyOn(accounts, "owners").mockImplementation(async (account) => ({
		items:
			account.id === "7"
				? [
						owner,
						{
							id: "99",
							path: "team",
							kind: "organization",
							canCreateRepository: null,
						},
					]
				: [{ id: "8", path: "bob", kind: "user", canCreateRepository: null }],
		next: null,
		rateLimit: {},
	}));
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

async function settle() {
	root.renderer.flush();
	await Bun.sleep(60);
	root.renderer.clockFastForward(200);
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	await Bun.sleep(0);
	root.renderer.flush();
}
function node(id: string) {
	const found = root.renderer.findByTestId(id);

	if (!found) throw new Error(`Missing ${id}`);

	return found;
}
async function click(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}
async function type(id: string, value: string) {
	await click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...value].join(" "));
	await settle();
}
function renderForm(
	onSubmit: (
		input: PublishRepositoryRequest
	) => Promise<GitResult<SyncResult> | undefined>,
	options: { created?: PublishedRepository; uncertain?: boolean } = {}
) {
	root.render(
		<RepositoryPublishView
			accounts={accounts}
			name="project"
			active
			disabled={false}
			onSubmit={onSubmit}
			onClose={() => {}}
			onCancel={() => {}}
			onSettings={() => {}}
			created={options.created}
			uncertain={options.uncertain ?? false}
		/>
	);
}

it("starts private, prefills the name, changes account/owner, and only submits on explicit Publish", async () => {
	const submit = mock(async (_input: PublishRepositoryRequest) => success);

	renderForm(submit);
	await settle();

	expect(node("publish-name").customProps?.value).toBe("project");
	expect(root.renderer.getAllText()).toContain("alice");
	expect(submit).not.toHaveBeenCalled();
	await click("publish-account-8");
	await click("publish-repository-submit");

	expect(submit).toHaveBeenCalledTimes(1);
	expect(submit.mock.calls[0]?.[0]).toMatchObject({
		account: bob,
		owner: { path: "bob" },
		name: "project",
		visibility: "private",
	});
	expect(
		root.renderer.findByTestId("publish-repository-success")
	).toBeDefined();
});

it("requires an explicit public choice and supports organization destinations", async () => {
	const submit = mock(async (_input: PublishRepositoryRequest) => success);

	renderForm(submit);
	await settle();
	await click("publish-owner");
	root.renderer.simulateKeystrokes("down enter");
	await settle();
	await click("publish-visibility-public");
	await type("publish-description", "Example");
	await click("publish-repository-submit");

	expect(submit.mock.calls[0]?.[0]).toMatchObject({
		owner: { path: "team" },
		visibility: "public",
		description: "Example",
	});
});

it("recovers a failed owner read and blocks invalid names", async () => {
	const owners = mock(async (): Promise<Page<Owner>> => {
		throw new Error("Offline");
	});

	spyOn(accounts, "owners").mockImplementation(owners);
	const submit = mock(async (_input: PublishRepositoryRequest) => success);

	renderForm(submit);
	await settle();
	expect(root.renderer.getAllText()).toContain("Offline");
	owners.mockImplementation(async () => ({
		items: [owner],
		next: null,
		rateLimit: {},
	}));
	await click("publish-retry-owners");
	await type("publish-name", "bad/name");
	await click("publish-repository-submit");

	expect(submit).not.toHaveBeenCalled();
	await type("publish-name", "valid-name");
	await click("publish-repository-submit");
	expect(submit).toHaveBeenCalledTimes(1);
});

it("uses a known receipt for Retry push and never repeats uncertain creation", async () => {
	const submit = mock(async (_input: PublishRepositoryRequest) => failed);

	renderForm(submit, { created: receipt });
	await settle();
	expect(root.renderer.getAllText()).toContain("Retry push");
	await click("publish-repository-submit");
	expect(submit.mock.calls[0]?.[0].created).toEqual(receipt);

	root.render(
		<RepositoryPublishView
			key="uncertain"
			accounts={accounts}
			name="project"
			active
			disabled={false}
			uncertain
			onSubmit={submit}
			onClose={() => {}}
			onCancel={() => {}}
			onSettings={() => {}}
		/>
	);
	await settle();
	await click("publish-repository-submit");
	expect(submit).toHaveBeenCalledTimes(1);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Creation will not be repeated automatically."
	);
});

it("places the form right of the sidebar, survives dismissal after failed push, and returns to Sync after success", async () => {
	let remoteCount = 0;
	let upstream: string | null = null;

	const write = mock<typeof RepositoryPublish.prototype.write>(
		async (_root, _input, _identity, _signal, onCreated) => {
			onCreated(receipt);
			remoteCount = 1;

			return failed;
		}
	);

	spyOn(RepositoryPublish.prototype, "write").mockImplementation(write);
	root.render(
		<App
			accounts={accounts}
			remoteAccounts={new RemoteAccounts(accounts, "/unused/bindings.json")}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Draft stays" },
				],
			}}
			readRepository={async () => ({
				ok: true,
				value: {
					...repositorySnapshot(),
					head: { ...repositorySnapshot().head, upstream },
					remoteCount,
				},
			})}
			readLastCommit={async () => ({
				ok: false,
				error: {
					code: "not-found",
					operation: "get-commit",
					message: "No footer fixture",
					retryable: false,
				},
			})}
			readBranches={async () => ({
				ok: true,
				value: {
					branches: { current: "main", branches: [] },
					worktrees: [],
					remotes: [],
				},
			})}
		/>
	);
	await settle();
	root.renderer.nativeSimulateKeyDown(node("rail-sync").id, "enter");
	await settle();
	const form = root.renderer.getElementBounds(
		node("publish-repository-view").id
	);

	const composer = root.renderer.getElementBounds(node("commit-composer").id);

	expect(form?.x).toBeGreaterThanOrEqual(
		(composer?.x ?? 0) + (composer?.width ?? 0)
	);
	const screenshot = process.env.GPUIX_PUBLISH_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	await click("publish-repository-submit");
	expect(root.renderer.getAllText()).toContain("Retry push");
	await click("publish-repository-cancel");
	await click("rail-sync");
	expect(root.renderer.getAllText()).toContain("Retry push");
	write.mockImplementation(async () => {
		upstream = "origin/main";

		return success;
	});
	await click("publish-repository-submit");
	expect(write.mock.calls[1]?.[1].created).toEqual(receipt);
	await click("publish-repository-cancel");
	expect(node("rail-sync").customProps?.["aria-label"]).toContain(
		"Repository published"
	);
	expect(node("commit-message").customProps?.value).toBe("Draft stays");
});

it("locks duplicate publishing and commits across linked workspaces, and supports Stop", async () => {
	const pending = Promise.withResolvers<GitResult<SyncResult>>();

	const write = mock<typeof RepositoryPublish.prototype.write>(
		() => pending.promise
	);

	const commit = mock(async () => {
		throw new Error("No commit expected");
	});

	spyOn(RepositoryPublish.prototype, "write").mockImplementation(write);
	root.render(
		<App
			accounts={accounts}
			remoteAccounts={new RemoteAccounts(accounts, "/unused/bindings.json")}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [
					{ id: "workspace-1", path: "/test/project", draft: "Draft" },
					{ id: "workspace-2", path: "/test/linked", draft: "Linked draft" },
				],
			}}
			readRepository={async (path) => ({
				ok: true,
				value: {
					...repositorySnapshot([changedFile("file.txt")]),
					repository: { ...repositorySnapshot().repository, root: path },
					remoteCount: 0,
				},
			})}
			readLastCommit={async () => ({
				ok: false,
				error: {
					code: "not-found",
					operation: "get-commit",
					message: "No fixture footer",
					retryable: false,
				},
			})}
			writeCommit={commit}
		/>
	);
	await settle();
	await click("rail-sync");
	await click("publish-repository-submit");
	await click("publish-repository-submit");
	await click("commit-submit");
	expect(write).toHaveBeenCalledTimes(1);
	expect(commit).not.toHaveBeenCalled();
	await click("workspace-2");
	await click("commit-submit");
	expect(commit).not.toHaveBeenCalled();
	await click("workspace-1");
	await click("publish-repository-cancel");
	expect(write.mock.calls[0]?.[3].aborted).toBe(true);
	pending.resolve(failed);
	await settle();
});

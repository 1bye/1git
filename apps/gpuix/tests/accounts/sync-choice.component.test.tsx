/**
 * Covers: native account chooser, remote-host icons, compact summaries and explicit draft account saves.
 * Real: React/native controls, modal keyboard handling and persisted public choices.
 * Doubles: OS vault; no provider requests, Git writes or real accounts.
 * Requires: native addon and graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Button } from "@1git/gpuix-ui/button";
import { useSyncAccount } from "../../src/feature/accounts/use-sync-account";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";
import { GitSettings } from "../../src/feature/git-settings/git-settings";
import { RemoteProviderIcon } from "../../src/feature/git-settings/remote-account";
import type {
	GitSettingsData,
	GitSettingsRequest,
} from "../../src/feature/git-settings/git-settings-model";
import { windowOptions } from "../../src/window-options";
import { appTokens } from "../../src/styles/tokens";

const accounts: readonly SavedAccount[] = [
	{
		provider: "github",
		webUrl: "https://github.com/",
		id: "7",
		username: "personal",
	},
	{
		provider: "github",
		webUrl: "https://github.com/",
		id: "8",
		username: "work",
	},
];

const url = "https://github.com/team/project.git";
let root: TestRoot;
let directory: string;

beforeEach(() => {
	root = createTestRoot({
		width: 900,
		height: 700,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	directory = mkdtempSync(join(tmpdir(), "sync-choice-ui-"));
});
afterEach(() => {
	root.unmount();
	mock.restore();
	rmSync(directory, { recursive: true, force: true });
});

async function settle() {
	root.renderer.flush();
	await Bun.sleep(30);
	root.renderer.clockFastForward(200);
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	await Bun.sleep(0);
	root.renderer.flush();
}
async function click(id: string) {
	const node = root.renderer.findByTestId(id);
	let bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error(`Missing ${id}`);

	const scroll = root.renderer.findByTestId("git-settings-editor-scroll");
	const viewport = scroll && root.renderer.getElementBounds(scroll.id);

	if (
		scroll &&
		viewport &&
		bounds.y + bounds.height > viewport.y + viewport.height
	) {
		const offset = root.renderer.getScrollOffset(scroll.id)?.[1] ?? 0;

		root.renderer.scrollTo(
			scroll.id,
			0,
			offset - (bounds.y + bounds.height - viewport.y - viewport.height) - 8
		);
		await settle();
		bounds = node && root.renderer.getElementBounds(node.id);
	}

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}

function Chooser({
	controller,
	onResult,
	queue = false,
}: {
	controller: AbortController;
	onResult: (key: string | null) => void;
	queue?: boolean;
}) {
	const { choose, dialog } = useSyncAccount();

	return (
		<div>
			<Button
				testId="start-choice"
				onPress={() => {
					void (async () => {
						const first = choose("origin", url, accounts, controller.signal);

						const second = queue
							? choose("second", url, accounts, controller.signal)
							: null;

						onResult(await first);

						if (second) onResult(await second);
					})();
				}}
			>
				Synchronize
			</Button>
			{dialog}
		</div>
	);
}

it("chooses one account, then handles a second queued remote with system credentials", async () => {
	const results: (string | null)[] = [];

	root.render(
		<Chooser
			controller={new AbortController()}
			queue
			onResult={(key) => results.push(key)}
		/>
	);
	await click("start-choice");
	expect(root.renderer.getAllText()).toContain("Account for origin");
	const screenshot = process.env.GPUIX_SYNC_ACCOUNT_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(screenshot);

	await click("sync-account-8");
	expect(results).toEqual([AccountStore.key(accounts[1]!)]);
	expect(root.renderer.getAllText()).toContain("Account for second");
	await click("sync-account-system");
	expect(results).toEqual([AccountStore.key(accounts[1]!), "system"]);
});

it("cancels with Escape, aborts queued requests, and resolves unmounted prompts", async () => {
	const results: (string | null)[] = [];
	const controller = new AbortController();

	root.render(
		<Chooser controller={controller} onResult={(key) => results.push(key)} />
	);
	await click("start-choice");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(results).toEqual([null]);
	await click("start-choice");
	controller.abort();
	await settle();
	expect(results).toEqual([null, null]);
	root.render(
		<Chooser
			key="fresh"
			controller={new AbortController()}
			onResult={(key) => results.push(key)}
		/>
	);
	await click("start-choice");
	root.render(<text>Closed</text>);
	await settle();
	expect(results).toEqual([null, null, null]);
});

function remotesFixture(
	saved: readonly SavedAccount[] = accounts,
	urls = [url]
) {
	const store = new AccountStore(join(directory, "accounts.json"));

	store.save(saved);
	const service = new Accounts(store, {
		async read() {
			throw new Error("Vault must not be read by the selector.");
		},
		async write() {},
		async delete() {},
	});

	const bindings = new RemoteAccounts(service, join(directory, "choices.json"));

	let data: GitSettingsData = {
		commonDirectory: "repo/.git",
		custom: false,
		identity: { name: "Existing author", email: "author@example.invalid" },
		remotes: [
			{
				name: "origin",
				fetchUrls: [urls[0] ?? url],
				pushUrls: urls,
				defaultBranch: "main",
			},
		],
	};

	const read = mock(async () => ({ ok: true as const, value: data }));

	const write = mock(
		async (_root: string | null, request: GitSettingsRequest) => {
			if (request.kind === "edit-remote" || request.kind === "add-remote")
				data = {
					...data,
					remotes: [
						{
							name: request.name,
							fetchUrls: [request.url],
							pushUrls: [request.url],
							defaultBranch: "main",
						},
					],
				};

			return { ok: true as const, value: data };
		}
	);

	root.render(
		<div
			style={{
				display: "flex",
				flexGrow: 1,
				minHeight: 0,
				height: "100%",
				backgroundColor: appTokens.colors.background,
			}}
		>
			<GitSettings
				root="repo"
				page="remotes"
				accounts={saved}
				remoteAccounts={bindings}
				read={read}
				write={write}
				onBusy={() => {}}
			/>
		</div>
	);

	return { bindings, read, write };
}

const tile = (choice: string, destination = url, remote = "origin") =>
	`remote-account-choice-${remote}-${encodeURIComponent(destination)}-${choice}`;

const summary = (destination = url) =>
	`remote-account-origin-${encodeURIComponent(destination)}`;

it("shows a compact automatic account and edits draft tiles only in the right-side form", async () => {
	const f = remotesFixture([accounts[0]!]);

	await settle();
	expect(root.renderer.getAllText()).toContain("personal");
	expect(root.renderer.getAllText()).toContain("Automatic");
	expect(root.renderer.findByTestId(tile("automatic"))).toBeUndefined();
	const summaryNode = root.renderer.findByTestId(summary());

	expect(summaryNode).not.toBeNull();
	expect(root.renderer.getElementBounds(summaryNode!.id)!.height).toBeLessThan(
		30
	);
	const providerIcon = root.renderer.findByTestId(
		"remote-provider-origin-github"
	);

	expect(providerIcon).toBeDefined();
	expect(root.renderer.getElementBounds(providerIcon!.id)!.x).toBeLessThan(
		root.renderer.getElementBounds(summaryNode!.id)!.x
	);
	expect(root.renderer.getElementBounds(providerIcon!.id)!.width).toBe(20);
	const screenshot = process.env.GPUIX_REMOTE_ACCOUNT_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}-summary.png`);

	await click("remote-edit-origin");
	const editor = root.renderer.findByTestId("remote-editor");
	const list = root.renderer.findByTestId("git-settings-scroll");

	expect(root.renderer.getElementBounds(editor!.id)!.x).toBeGreaterThan(
		root.renderer.getElementBounds(list!.id)!.x
	);

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}-editor.png`);

	await click(tile("system"));
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
	await click("remote-cancel");
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
	expect(f.write).not.toHaveBeenCalled();
	await click("remote-edit-origin");
	await click("remote-save");
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
});

it("saves a keyboard-selected account without Git config writes or author changes", async () => {
	const f = remotesFixture();

	await settle();
	await click("remote-edit-origin");
	const account = root.renderer.findByTestId(
		tile(AccountStore.key(accounts[1]!))
	);

	root.renderer.focusElement(account!.id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
	await click("remote-save");
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe(
		AccountStore.key(accounts[1]!)
	);
	expect(f.write).not.toHaveBeenCalled();
	expect((await f.read()).value.identity.name).toBe("Existing author");
	expect(root.renderer.getAllText()).toContain("work");
	expect(root.renderer.findByTestId("remote-editor")).toBeUndefined();
	await click("remote-edit-origin");
	await click(tile("automatic"));
	await click("remote-save");
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
});

it("keeps fetch and push destinations independent and reports account save failures safely", async () => {
	const push = "https://github.com/team/push.git";
	const f = remotesFixture(accounts, [url, push]);

	await settle();
	await click("remote-edit-origin");
	await click(tile(AccountStore.key(accounts[0]!), url));
	await click(tile("system", push));
	await click("remote-save");
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe(
		AccountStore.key(accounts[0]!)
	);
	expect(f.bindings.choice("repo/.git", "origin", push)).toBe("system");
	expect(f.write).not.toHaveBeenCalled();
	await click("remote-edit-origin");
	await click(tile("automatic", url));
	spyOn(f.bindings, "select").mockImplementation(() => {
		throw new Error("private storage path");
	});
	await click("remote-save");
	expect(root.renderer.findByTestId("remote-editor")).not.toBeNull();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Could not save the account choice"
	);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"private storage path"
	);
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe(
		AccountStore.key(accounts[0]!)
	);
});

it("never carries a selected account to a changed host and keeps SSH on system Git", async () => {
	const f = remotesFixture();

	await settle();
	await click("remote-edit-origin");
	await click(tile(AccountStore.key(accounts[1]!)));
	await click("remote-url");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[..."git@github.com:team/project.git"].join(" ")
	);
	await settle();
	expect(root.renderer.findByTestId(tile("system"))).toBeUndefined();
	await click("remote-save");
	expect(f.write).toHaveBeenCalledTimes(1);
	expect(f.bindings.choice("repo/.git", "origin", url)).toBe("automatic");
});

it("persists an account when adding a remote only after the URL save succeeds", async () => {
	const f = remotesFixture();

	await settle();
	await click("remote-add");
	await click("remote-name");
	root.renderer.simulateKeystrokes("u p s t r e a m");
	await click("remote-url");
	root.renderer.simulateKeystrokes([...url].join(" "));
	await settle();
	await click(tile(AccountStore.key(accounts[1]!), url, "upstream"));
	expect(f.bindings.choice("repo/.git", "upstream", url)).toBe("automatic");
	await click("remote-save");
	expect(f.write).toHaveBeenCalledWith("repo", {
		kind: "add-remote",
		name: "upstream",
		url,
	});
	expect(f.bindings.choice("repo/.git", "upstream", url)).toBe(
		AccountStore.key(accounts[1]!)
	);
});

it("does not persist a draft account when the remote URL write fails", async () => {
	const f = remotesFixture();
	const nextUrl = "https://github.com/team/new-project.git";

	await settle();
	await click("remote-edit-origin");
	await click("remote-url");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...nextUrl].join(" "));
	await settle();
	await click(tile(AccountStore.key(accounts[1]!), nextUrl));
	f.write.mockRejectedValueOnce(new Error("private failure detail"));
	await click("remote-save");
	expect(f.bindings.choice("repo/.git", "origin", nextUrl)).toBe("automatic");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Could not confirm the save"
	);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"private failure detail"
	);
});

it.each([
	["https://github.com/team/project.git", "github"],
	["git@github.com:team/project.git", "github"],
	["ssh://git@github.com/team/project.git", "github"],
	["https://gitlab.com/team/subgroup/project.git", "gitlab"],
	["git@gitlab.com:team/project.git", "gitlab"],
	["https://custom.example/team/project.git", "custom"],
	["https://github.com.evil.example/team/project.git", "custom"],
	["/tmp/local-repository.git", "custom"],
])(
	"shows the %s host icon without an account or network lookup",
	async (remote, kind) => {
		root.render(
			<RemoteProviderIcon url={remote} accounts={[]} testId="provider" />
		);
		await settle();
		expect(root.renderer.findByTestId(`provider-${kind}`)).toBeDefined();
	}
);

it("uses configured self-hosted provider metadata, not the selected authentication account", async () => {
	const selfHosted: SavedAccount = {
		provider: "gitlab",
		webUrl: "https://code.example/gitlab/",
		id: "9",
		username: "team",
	};

	root.render(
		<RemoteProviderIcon
			url="https://code.example/gitlab/group/project.git"
			accounts={[accounts[0]!, selfHosted]}
			testId="provider"
		/>
	);
	await settle();
	expect(root.renderer.findByTestId("provider-gitlab")).toBeDefined();
	root.render(
		<RemoteProviderIcon
			url="git@code.example:group/project.git"
			accounts={[selfHosted]}
			testId="provider"
		/>
	);
	await settle();
	expect(root.renderer.findByTestId("provider-gitlab")).toBeDefined();
});

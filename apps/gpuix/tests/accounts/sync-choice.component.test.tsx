/**
 * Covers: native account chooser selection, queued requests, abort/unmount cleanup and Remotes override.
 * Real: React/native controls, modal keyboard handling and persisted public choices.
 * Doubles: OS vault; no provider requests, Git writes or real accounts.
 * Requires: native addon and graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
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
import { RemoteAccountSelect } from "../../src/feature/git-settings/remote-account-select";
import { windowOptions } from "../../src/window-options";

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
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error(`Missing ${id}`);

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

it("saves an account override through the native Remotes select without accessing credentials", async () => {
	const store = new AccountStore(join(directory, "accounts.json"));

	store.save(accounts);
	const service = new Accounts(store, {
		async read() {
			throw new Error("Vault must not be read by the selector.");
		},
		async write() {},
		async delete() {},
	});

	const bindings = new RemoteAccounts(service, join(directory, "choices.json"));

	root.render(
		<RemoteAccountSelect
			bindings={bindings}
			directory="repo/.git"
			remote="origin"
			url={url}
			disabled={false}
		/>
	);
	await click("remote-account-origin");
	root.renderer.simulateKeystrokes("down down down enter");
	await settle();
	expect(bindings.choice("repo/.git", "origin", url)).toBe(
		AccountStore.key(accounts[1]!)
	);
	expect(root.renderer.getAllText()).toContain("work");
});

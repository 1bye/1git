/**
 * Covers: first-run/replay setup, account editing, theme/default preservation, identity saving, repository discovery and success/cancellation.
 * Real: App, native setup/forms, session persistence and repository connection lifecycle.
 * Doubles: Git config/repository/setup, discovery scanner, folder picker, GitHub CLI, hosting HTTP/vault and disposable account metadata.
 * Requires: patched native renderer and macOS graphics; no user credentials, Git writes or network.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { spacing } from "@1git/design-tokens";
import { App } from "../../src/app";
import type {
	GitSettingsModel,
	GitSettingsData,
} from "../../src/feature/git-settings/git-settings-model";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import type { GitHubCliAccount } from "../../src/feature/accounts/lib/github-cli";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryProgress,
} from "../../src/feature/repository-discovery/repository-discovery";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";

let root: TestRoot;
let f: ReturnType<typeof hostingRepositories>;

beforeEach(() => {
	f = hostingRepositories();
	spyOn(f.accounts, "cliAccounts").mockResolvedValue([]);
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
	rmSync(f.directory, { recursive: true, force: true });
});

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

async function settle() {
	for (let i = 0; i < 5; i++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(200);
	root.renderer.flush();
}
async function click(id: string) {
	await reveal(id);
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}
async function edit(id: string, value: string) {
	await reveal(id);
	root.renderer.focusElement(node(id).id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		value
			? [...value]
					.map((character) => (character === " " ? "space" : character))
					.join(" ")
			: "backspace"
	);
	await settle();
}
async function reveal(id: string) {
	if (
		![
			"onboarding-name",
			"onboarding-email",
			"onboarding-save-identity",
			"onboarding-retry-identity",
			"onboarding-identity-toggle",
		].includes(id) &&
		!id.startsWith("onboarding-space") &&
		!id.startsWith("account-auth-") &&
		!id.startsWith("onboarding-provider-") &&
		![
			"account-token",
			"account-client-id",
			"account-advanced",
			"account-host",
			"account-callback",
		].includes(id)
	)
		return;

	const content = node(
		id.startsWith("account-")
			? "onboarding-account-scroll"
			: "onboarding-content"
	);

	const viewport = root.renderer.getElementBounds(content.id)!;

	const bounds = root.renderer.getElementBounds(node(id).id)!;

	if (
		bounds.y < viewport.y ||
		bounds.y + bounds.height > viewport.y + viewport.height
	) {
		const offset = root.renderer.getScrollOffset(content.id)?.[1] ?? 0;

		root.renderer.scrollTo(content.id, 0, offset - (bounds.y - viewport.y) + 8);
		await settle();
	}
}
function fixture() {
	let data: GitSettingsData = {
		identity: { name: "Existing Author", email: "existing@example.test" },
		custom: true,
		remotes: [],
	};

	const read = mock<typeof GitSettingsModel.read>(async () => ({
		ok: true,
		value: data,
	}));

	const write = mock<typeof GitSettingsModel.write>(async (_root, request) => {
		if (request.kind !== "identity") throw new Error("Unexpected remote write");

		data = { ...data, identity: request.identity };

		return { ok: true, value: data };
	});

	const save = mock<(document: WorkspaceSessionDocument) => void>(() => {});

	return {
		accounts: f.accounts,
		readGitSettings: read,
		writeGitSettings: write,
		saveSession: save,
	};
}

it("prefers a signed-in GitHub CLI account during onboarding without connecting it", async () => {
	const found: GitHubCliAccount[] = [
		{ host: "github.com", username: "octocat", active: true },
	];

	const discovery = spyOn(f.accounts, "cliAccounts").mockResolvedValue(found);
	const connect = spyOn(f.accounts, "connectCli");

	root.render(<App {...fixture()} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-github");

	expect(
		node("account-auth-github-cli").customProps?.["aria-description"]
	).toBe("Selected connection method");
	expect(
		node("account-cli-github.com-octocat").customProps?.["aria-description"]
	).toBe("Selected account");
	expect(node("account-connect").customProps?.tabIndex).toBe(0);
	expect(node("account-connect").style.opacity).not.toBe(0.45);
	expect(discovery).toHaveBeenCalledTimes(1);
	expect(connect).not.toHaveBeenCalled();
	expect(f.requests).toHaveLength(0);

	if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-cli.png`
		);
});

it("preselects the CLI method with multiple accounts and requires an explicit account choice", async () => {
	spyOn(f.accounts, "cliAccounts").mockResolvedValue([
		{ host: "github.com", username: "first", active: true },
		{ host: "github.com", username: "second", active: false },
	]);
	root.render(<App {...fixture()} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-github");

	expect(
		node("account-auth-github-cli").customProps?.["aria-description"]
	).toBe("Selected connection method");
	expect(node("account-connect").style.opacity).toBe(0.45);
	await click("account-cli-github.com-second");
	expect(
		node("account-cli-github.com-second").customProps?.["aria-description"]
	).toBe("Selected account");
	expect(node("account-connect").customProps?.tabIndex).toBe(0);
	expect(f.requests).toHaveLength(0);
});

it.each(["signed out", "unavailable"])(
	"keeps browser sign-in when GitHub CLI is %s",
	async (state) => {
		const discovery = spyOn(f.accounts, "cliAccounts");

		if (state === "unavailable")
			discovery.mockRejectedValue(new Error("GitHub CLI is not installed."));
		else discovery.mockResolvedValue([]);

		root.render(<App {...fixture()} initialOnboarding="git" />);
		await settle();
		await click("onboarding-provider-github");

		expect(node("account-auth-browser").customProps?.["aria-description"]).toBe(
			"Selected connection method"
		);
		expect(node("account-client-id")).toBeDefined();
		expect(root.renderer.findByTestId("account-cli-error")).toBeUndefined();
		expect(f.requests).toHaveLength(0);
	}
);

it.each(["browser", "token"] as const)(
	"preserves an explicit %s choice when CLI discovery finishes later",
	async (method) => {
		const discovery = Promise.withResolvers<readonly GitHubCliAccount[]>();

		spyOn(f.accounts, "cliAccounts").mockReturnValue(discovery.promise);
		root.render(<App {...fixture()} initialOnboarding="git" />);
		await settle();
		await click("onboarding-provider-github");
		await click(`account-auth-${method}`);

		if (method === "token") await edit("account-token", "keep-this-draft");

		discovery.resolve([
			{ host: "github.com", username: "octocat", active: true },
		]);
		await settle();

		expect(
			node(`account-auth-${method}`).customProps?.["aria-description"]
		).toBe("Selected connection method");
		expect(
			root.renderer.findByTestId("account-cli-github.com-octocat")
		).toBeUndefined();

		if (method === "token")
			expect(node("account-connect").customProps?.tabIndex).toBe(0);

		expect(f.requests).toHaveLength(0);
	}
);

it("ignores stale GitHub discovery after switching to GitLab", async () => {
	const discovery = Promise.withResolvers<readonly GitHubCliAccount[]>();
	let signal: AbortSignal | undefined;

	spyOn(f.accounts, "cliAccounts").mockImplementation((current) => {
		signal = current;

		return discovery.promise;
	});
	root.render(<App {...fixture()} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-github");
	await click("onboarding-provider-gitlab");
	discovery.resolve([
		{ host: "github.com", username: "octocat", active: true },
	]);
	await settle();

	expect(signal?.aborted).toBe(true);
	expect(root.renderer.findByTestId("account-auth-github-cli")).toBeUndefined();
	expect(node("account-auth-browser").customProps?.["aria-description"]).toBe(
		"Selected connection method"
	);
	expect(f.requests).toHaveLength(0);
});

it.each(["light", "dark", "system"] as const)(
	"keeps theme selection explicit and finishes setup with Continue without opening a repository (%s)",
	async (appearance) => {
		const props = fixture();

		const reader = mock<typeof RepositoryReader.read>(async () => ({
			ok: true,
			value: repositorySnapshot(),
		}));

		root.render(
			<App {...props} initialOnboarding="welcome" readRepository={reader} />
		);
		await settle();
		expect(root.renderer.getAllText()).toContain("1 of 4");
		expect(root.renderer.getFocusedElementId()).toBe(
			node("appearance-light").id
		);
		expect(node("appearance-system").customProps?.["aria-description"]).toBe(
			"Selected"
		);
		await click(`appearance-${appearance}`);
		const screenshot = process.env.GPUIX_ONBOARDING_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-welcome.png`
			);

		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("Connect your accounts");
		expect(node("onboarding-connected-accounts")).toBeDefined();
		expect(root.renderer.getAllText()).toContain("tester");
		expect(root.renderer.getAllText()).toContain("lab-user");
		expect(root.renderer.findByTestId("onboarding-name")).toBeUndefined();
		expect(f.requests).toHaveLength(0);

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}-git.png`);

		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("3 of 4");
		expect(node("onboarding-spaces")).toBeDefined();
		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("4 of 4");
		const footer = root.renderer.getElementBounds(
			node("onboarding-footer").id
		)!;

		expect(footer.y + footer.height).toBeLessThanOrEqual(640);
		expect(node("onboarding-repository-create")).toBeDefined();
		expect(node("onboarding-repository-clone")).toBeDefined();
		expect(root.renderer.findByTestId("onboarding-skip")).toBeUndefined();
		const back = root.renderer.getElementBounds(node("onboarding-back").id)!;

		const continueButton = root.renderer.getElementBounds(
			node("onboarding-next").id
		)!;

		expect(back.x).toBeLessThan(continueButton.x);
		expect(node("onboarding-next").customProps?.["aria-label"]).toBe(
			"Continue"
		);

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-repository.png`
			);

		await click("onboarding-next");
		expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
		expect(reader).not.toHaveBeenCalled();
		expect(props.writeGitSettings).not.toHaveBeenCalled();
		root.render(<div />);
		const saved = props.saveSession.mock.calls.at(-1)?.[0];

		expect(saved?.onboarding).toBe("complete");
		expect(saved?.appearance).toBe(appearance);
		root.render(<App {...props} initialSession={saved} />);
		await settle();
		expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	}
);

it("cancels inline account setup and returns from Back without saving or losing identity edits", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-identity-toggle");
	await edit("onboarding-name", "Draft Author");
	await click("onboarding-provider-github");
	expect(node("account-setup-content")).toBeDefined();
	expect(node("onboarding-connected-accounts")).toBeDefined();
	expect(node("onboarding-account-panel")).toBeDefined();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
	await click("accounts-cancel");
	expect(root.renderer.getAllText()).toContain("2 of 4");
	expect(node("onboarding-name").customProps?.value).toBe("Draft Author");
	await click("onboarding-back");
	await click("onboarding-next");
	expect(node("onboarding-name").customProps?.value).toBe("Draft Author");
	await click("onboarding-next");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
	expect(f.requests).toHaveLength(0);
});

it.each(["github", "gitlab"] as const)(
	"connects %s directly in step 2, masks credentials and keeps identity unchanged",
	async (provider) => {
		const props = fixture();

		f.store.save([]);
		f.secrets.clear();
		root.render(<App {...props} initialOnboarding="git" />);
		await settle();
		await click(`onboarding-provider-${provider}`);
		expect(node("account-client-id")).toBeDefined();
		expect(
			node("account-repository-access").customProps?.["aria-checked"]
		).toBe(false);
		await click("account-auth-token");
		await edit("account-token", "synthetic-onboarding-token");
		const screenshot = process.env.GPUIX_ONBOARDING_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${provider}-token.png`);

		expect(JSON.stringify(root.renderer.toJSON())).not.toContain(
			"synthetic-onboarding-token"
		);
		expect(JSON.stringify(root.renderer.getA11yTree())).not.toContain(
			"synthetic-onboarding-token"
		);
		expect(f.requests).toHaveLength(0);
		await click("account-connect");
		expect(root.renderer.getAllText()).toContain("2 of 4");
		expect(root.renderer.findByTestId("account-token")).toBeUndefined();
		expect(node("onboarding-connected-accounts")).toBeDefined();
		expect(root.renderer.getAllText().join("\n")).toContain("Connected");
		expect(f.accounts.load()).toHaveLength(1);
		expect(f.accounts.load()[0]?.provider).toBe(provider);
		expect([...f.secrets.values()]).toContain("synthetic-onboarding-token");
		expect(props.writeGitSettings).not.toHaveBeenCalled();
		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("3 of 4");
	}
);

it("allows continuing or skipping without accounts and discards unsubmitted secrets", async () => {
	const props = fixture();

	f.store.save([]);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-github");
	await click("account-auth-token");
	await edit("account-token", "discard-this-secret");
	await click("onboarding-provider-gitlab");
	expect(node("account-connect").style.opacity).toBe(0.45);
	await edit("account-token", "another-secret");
	await click("onboarding-next");
	expect(root.renderer.getAllText()).toContain("3 of 4");
	await click("onboarding-back");
	expect(root.renderer.findByTestId("account-token")).toBeUndefined();
	await click("onboarding-provider-gitlab");
	await click("account-auth-token");
	expect(node("account-connect").style.opacity).toBe(0.45);
	await click("onboarding-skip");
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	expect(f.requests).toHaveLength(0);
	expect(f.accounts.load()).toHaveLength(0);
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it("delegates browser sign-in, pins cancellation and blocks step changes during authorization", async () => {
	const props = fixture();
	let signal: AbortSignal | undefined;

	const signIn = spyOn(f.accounts, "connectBrowser").mockImplementation(
		(request) => {
			signal = request.signal;
			request.onDeviceCode?.({
				userCode: "PUBLIC-CODE",
				verificationUrl: "https://github.com/login/device",
				expiresAt: Date.now() + 900_000,
			});

			return new Promise((_resolve, reject) => {
				request.signal?.addEventListener(
					"abort",
					() => reject(new Error("Cancelled")),
					{ once: true }
				);
			});
		}
	);

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-github");
	await edit("account-client-id", "public-client-id");
	await click("account-connect");
	expect(signIn).toHaveBeenCalledTimes(1);
	expect(signIn.mock.calls[0]?.[0]).toMatchObject({
		provider: "github",
		webUrl: "https://github.com",
		repositoryAccess: false,
		registration: { clientId: "public-client-id" },
	});
	expect(root.renderer.getAllText()).toContain("PUBLIC-CODE");
	const screenshot = process.env.GPUIX_ONBOARDING_SCREENSHOT;

	if (screenshot)
		root.renderer.captureScreenshot(`${screenshot}-browser-pending.png`);

	for (const id of ["onboarding-next", "onboarding-back", "onboarding-skip"]) {
		expect(node(id).style.opacity).toBe(0.45);
		await click(id);
	}

	expect(root.renderer.getAllText()).toContain("2 of 4");

	const actions = root.renderer.getElementBounds(
		node("onboarding-account-actions").id
	)!;

	expect(actions.y + actions.height).toBeLessThanOrEqual(640);
	await click("accounts-cancel");
	expect(signal?.aborted).toBe(true);
	expect(root.renderer.findByTestId("account-device-code")).toBeUndefined();
	expect(node("onboarding-next").customProps?.tabIndex).toBe(0);
	expect(f.requests).toHaveLength(0);
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it("reloads accounts created outside step 2 and preserves setup navigation", async () => {
	const props = fixture();

	f.store.save([]);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	expect(
		root.renderer.findByTestId("onboarding-connected-accounts")
	).toBeUndefined();
	await click("onboarding-next");
	f.store.save(f.saved);
	await click("onboarding-back");
	expect(node("onboarding-connected-accounts")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("tester");
	expect(f.requests).toHaveLength(0);
});

it("keeps account actions pinned while scrolling and allows keyboard cancellation", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-gitlab");
	const content = node("onboarding-account-scroll");
	const leftContent = node("onboarding-content");
	const leftOffset = root.renderer.getScrollOffset(leftContent.id);
	const viewport = root.renderer.getElementBounds(content.id)!;
	const cancel = root.renderer.getElementBounds(node("accounts-cancel").id)!;
	const connect = root.renderer.getElementBounds(node("account-connect").id)!;

	expect(cancel.y).toBeGreaterThanOrEqual(viewport.y + viewport.height);
	root.renderer.nativeSimulateScrollWheel(
		viewport.x + viewport.width - 10,
		viewport.y + 80,
		0,
		-240
	);
	await settle();
	expect(root.renderer.getScrollOffset(content.id)?.[1]).toBeLessThan(0);
	expect(root.renderer.getElementBounds(node("accounts-cancel").id)).toEqual(
		cancel
	);
	expect(root.renderer.getElementBounds(node("account-connect").id)).toEqual(
		connect
	);
	expect(root.renderer.getScrollOffset(leftContent.id)).toEqual(leftOffset);
	root.renderer.focusElement(node("accounts-cancel").id);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("account-setup-content")).toBeUndefined();
	expect(node("onboarding-accounts")).toBeDefined();
	expect(f.requests).toHaveLength(0);
});

it.each(["light", "dark"] as const)(
	"keeps account editing in a separate right pane with independent actions (%s)",
	async (appearance) => {
		const props = fixture();

		root.render(<App {...props} initialOnboarding="welcome" />);
		await settle();
		await click(`appearance-${appearance}`);
		await click("onboarding-next");
		await click("onboarding-provider-gitlab");
		const left = root.renderer.getElementBounds(node("onboarding-panel").id)!;

		const right = root.renderer.getElementBounds(
			node("onboarding-account-panel").id
		)!;

		const viewport = root.renderer.getElementBounds(
			node("onboarding-account-scroll").id
		)!;

		const form = root.renderer.getElementBounds(
			node("account-setup-content").id
		)!;

		const connect = root.renderer.getElementBounds(node("account-connect").id)!;

		const footer = root.renderer.getElementBounds(
			node("onboarding-footer").id
		)!;

		const actions = root.renderer.getElementBounds(
			node("onboarding-account-actions").id
		)!;

		const next = root.renderer.getElementBounds(node("onboarding-next").id)!;
		const cancel = root.renderer.getElementBounds(node("accounts-cancel").id)!;

		expect(form.width).toBe(viewport.width);
		expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
		expect(node("onboarding-account-panel").style.borderLeftWidth).toBe(1);
		expect(footer.x + footer.width).toBeLessThanOrEqual(right.x);
		expect(cancel.x).toBeGreaterThanOrEqual(right.x);
		expect(connect.x + connect.width).toBeLessThanOrEqual(
			right.x + right.width
		);
		expect(next.x + next.width).toBeLessThanOrEqual(left.x + left.width);
		expect(footer.y + footer.height).toBeLessThanOrEqual(640);
		expect(actions.y + actions.height).toBeLessThanOrEqual(640);
		expect(node("onboarding-connected-accounts")).toBeDefined();
		expect(root.renderer.getFocusedElementId()).toBe(
			node("account-auth-browser").id
		);
		const screenshot = process.env.GPUIX_ONBOARDING_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-split-accounts.png`
			);

		await click("accounts-cancel");
		expect(
			root.renderer.findByTestId("onboarding-account-panel")
		).toBeUndefined();
		expect(root.renderer.getFocusedElementId()).toBe(
			node("onboarding-provider-github").id
		);
	}
);

it("shows connection failures safely and still permits skipping accounts", async () => {
	const props = fixture();

	f.intercept(async () =>
		Response.json({ message: "never-display-provider-detail" }, { status: 401 })
	);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-provider-gitlab");
	await click("account-auth-token");
	await edit("account-token", "bad-synthetic-token");
	await click("account-connect");
	expect(node("accounts-error")).toBeDefined();
	expect(JSON.stringify(root.renderer.toJSON())).not.toContain(
		"bad-synthetic-token"
	);
	expect(root.renderer.getAllText().join("\n")).not.toContain(
		"never-display-provider-detail"
	);
	expect(node("account-connect").style.opacity).toBe(0.45);
	await click("onboarding-next");
	expect(root.renderer.getAllText()).toContain("3 of 4");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it("validates and saves identity only on explicit Save, blocks duplicate writes and rereads failure", async () => {
	const props = fixture();

	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof GitSettingsModel.write>>>();

	props.writeGitSettings.mockImplementation(() => pending.promise);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-identity-toggle");
	await edit("onboarding-email", "bad-email");
	await click("onboarding-save-identity");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
	expect(node("onboarding-identity-error")).toBeDefined();
	await edit("onboarding-email", "new@example.test");
	await click("onboarding-save-identity");
	await click("onboarding-save-identity");
	await click("onboarding-next");
	await click("onboarding-next");
	expect(props.writeGitSettings).toHaveBeenCalledTimes(1);
	expect(props.writeGitSettings).toHaveBeenCalledWith(null, {
		kind: "identity",
		custom: true,
		identity: { name: "Existing Author", email: "new@example.test" },
	});
	expect(root.renderer.getAllText()).toContain("2 of 4");
	pending.resolve({
		ok: false,
		error: {
			operation: "set-config",
			code: "command-failed",
			retryable: true,
			message: "Permission denied",
		},
	});
	await settle();
	expect(props.readGitSettings).toHaveBeenCalledTimes(2);
	expect(node("onboarding-email").customProps?.value).toBe("new@example.test");
	expect(root.renderer.getAllText()).toContain("Permission denied");
});

it("uses existing repository picking and completes only after a successful read", async () => {
	const props = fixture();
	const picker = mock(async () => [] as string[]);

	const reader = mock(async () => ({
		ok: false as const,
		error: {
			operation: "open-repository" as const,
			code: "not-found" as const,
			retryable: true,
			message: "Not a repository",
		},
	}));

	Object.assign(root.renderer, { promptForPaths: picker });
	root.render(
		<App {...props} initialOnboarding="repository" readRepository={reader} />
	);
	await settle();
	await click("onboarding-open");
	expect(node("onboarding-view")).toBeDefined();
	expect(reader).not.toHaveBeenCalled();
	picker.mockResolvedValue(["/test/project"]);
	await click("onboarding-open");
	expect(root.renderer.getAllText()).toContain("Not a repository");
	expect(node("onboarding-view")).toBeDefined();
	root.render(
		<App
			{...props}
			initialOnboarding="repository"
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
		/>
	);
	await settle();
	await click("onboarding-open");
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].onboarding).toBe("complete");
});

it.each(["light", "dark"] as const)(
	"starts discovery on step four, shows progressive results and opens a suggestion with the keyboard (%s)",
	async (appearance) => {
		const props = fixture();
		const pending = Promise.withResolvers<RepositoryDiscoveryProgress>();

		const progress: RepositoryDiscoveryProgress = {
			paths: [
				"/test/projects/1git",
				"/test/projects/website",
				"/test/work/api",
			],
			scanned: 30,
			skipped: 0,
			limited: false,
		};

		spyOn(RepositoryDiscovery, "resolveFolder").mockImplementation(
			async (path) => path
		);
		const scan = mock<typeof RepositoryDiscovery.scan>(
			async (_folders, _signal, report) => {
				report(progress);

				return await pending.promise;
			}
		);

		const opening =
			Promise.withResolvers<
				Awaited<ReturnType<typeof RepositoryReader.read>>
			>();

		const reader = mock<typeof RepositoryReader.read>(
			async () => await opening.promise
		);

		const picker = mock(async () => [] as string[]);

		Object.assign(root.renderer, { promptForPaths: picker });
		root.render(
			<App
				{...props}
				initialOnboarding="welcome"
				initialSession={{ version: 1, activeId: null, tabs: [], appearance }}
				discoverRepositories={scan}
				readRepository={reader}
			/>
		);
		await settle();
		expect(scan).not.toHaveBeenCalled();
		await click("onboarding-next");
		expect(scan).not.toHaveBeenCalled();
		await click("onboarding-next");
		expect(scan).not.toHaveBeenCalled();
		await click("onboarding-next");
		expect(scan.mock.calls.map(([folders]) => folders)).toEqual([[homedir()]]);
		expect(root.renderer.getAllText()).toContain("Searching… · Stop");
		expect(
			root.renderer.findByTestId("onboarding-discovery-status")
		).toBeUndefined();
		expect(node("onboarding-repository-/test/projects/1git")).toBeDefined();
		expect(node("onboarding-avatar-/test/projects/1git")).toBeDefined();
		expect(
			root.renderer.findByTestId("onboarding-star-/test/projects/1git")
		).toBeUndefined();
		expect(
			root.renderer.findByTestId("onboarding-forget-/test/projects/1git")
		).toBeUndefined();
		expect(node("onboarding-discovery-list").style.borderWidth ?? 0).toBe(0);
		expect(root.renderer.getAllText()).not.toContain(
			"You can also skip setup and add a repository later."
		);
		expect(reader).not.toHaveBeenCalled();
		expect(
			props.saveSession.mock.calls.at(-1)?.[0].recentRepositories ?? []
		).toEqual([]);

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-discovery.png`
			);

		pending.resolve(progress);
		await settle();
		expect(root.renderer.getAllText()).toContain(
			"Repositories on this Mac (3)"
		);
		expect(
			root.renderer.findByTestId("onboarding-discovery-status")
		).toBeUndefined();
		await click("onboarding-back");
		await click("onboarding-next");
		expect(scan).toHaveBeenCalledTimes(1);
		root.renderer.focusElement(
			node("onboarding-repository-/test/projects/1git").id
		);
		root.renderer.simulateKeystrokes("enter");
		await settle();
		expect(reader.mock.calls[0]?.[0]).toBe("/test/projects/1git");
		expect(
			node("onboarding-repository-/test/projects/website").customProps?.tabIndex
		).toBeUndefined();
		expect(node("onboarding-view")).toBeDefined();
		expect(node("onboarding-next").customProps?.tabIndex).toBeUndefined();
		expect(picker).not.toHaveBeenCalled();
		opening.resolve({ ok: true, value: repositorySnapshot() });
		await settle();
		expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
		root.render(<div />);
		expect(props.saveSession.mock.calls.at(-1)?.[0].onboarding).toBe(
			"complete"
		);
	}
);

it("keeps a failed suggestion open in onboarding and supports stopping and retrying discovery", async () => {
	const props = fixture();

	const progress: RepositoryDiscoveryProgress = {
		paths: ["/test/project"],
		scanned: 10,
		skipped: 0,
		limited: false,
	};

	const scan = mock<typeof RepositoryDiscovery.scan>(
		async (_folders, signal, report) => {
			report(progress);
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true })
			);

			return progress;
		}
	);

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: false,
		error: {
			operation: "open-repository",
			code: "not-found",
			retryable: true,
			message: "Repository moved",
		},
	}));

	root.render(
		<App
			{...props}
			initialOnboarding="repository"
			discoverRepositories={scan}
			readRepository={reader}
		/>
	);
	await settle();
	await click("onboarding-discovery-scan");
	expect(scan.mock.calls[0]?.[1].aborted).toBe(true);
	expect(root.renderer.getAllText().join(" ")).toContain("Search stopped.");
	await click("onboarding-repository-/test/project");
	expect(root.renderer.getAllText()).toContain("Repository moved");
	expect(node("onboarding-view")).toBeDefined();
	scan.mockResolvedValueOnce({ ...progress, paths: [] });
	await click("onboarding-discovery-scan");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"No repositories found."
	);
	scan.mockRejectedValueOnce(new Error("Search unavailable"));
	await click("onboarding-discovery-scan");
	expect(root.renderer.getAllText()).toContain("Search unavailable");
	scan.mockResolvedValueOnce({ ...progress, skipped: 2, limited: true });
	await click("onboarding-discovery-scan");
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Some folders could not be searched."
	);
	expect(root.renderer.getAllText()).toContain("Repositories on this Mac (1)");
	expect(
		root.renderer.findByTestId("onboarding-discovery-status")
	).toBeUndefined();
	expect(node("onboarding-repository-/test/project")).toBeDefined();
});

it("filters discovered repositories by name or path without rescanning, and clears empty results", async () => {
	const paths = [
		"/test/projects/1git",
		"/test/client/website",
		"/test/projects/api",
	];

	const scan = mock<typeof RepositoryDiscovery.scan>(async () => ({
		paths,
		scanned: 30,
		skipped: 0,
		limited: false,
	}));

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	root.render(
		<App
			{...fixture()}
			initialOnboarding="repository"
			discoverRepositories={scan}
			readRepository={reader}
		/>
	);
	await settle();
	await edit("onboarding-repository-search", " WEBSITE ");
	expect(root.renderer.getAllText()).toContain("Repositories on this Mac (1)");
	expect(node("onboarding-repository-/test/client/website")).toBeDefined();
	expect(
		root.renderer.findByTestId("onboarding-repository-/test/projects/1git")
	).toBeUndefined();
	await edit("onboarding-repository-search", "PROJECTS/");
	expect(root.renderer.getAllText()).toContain("Repositories on this Mac (2)");
	expect(node("onboarding-repository-/test/projects/1git")).toBeDefined();
	expect(node("onboarding-repository-/test/projects/api")).toBeDefined();
	await edit("onboarding-repository-search", "missing");
	expect(root.renderer.getAllText()).toContain("Repositories on this Mac (0)");
	expect(root.renderer.getAllText()).toContain(
		"No repositories match your search."
	);
	expect(
		root.renderer.findByTestId("onboarding-discovery-list")
	).toBeUndefined();
	await edit("onboarding-repository-search", "");
	expect(root.renderer.getAllText()).toContain("Repositories on this Mac (3)");
	expect(node("onboarding-repository-/test/client/website")).toBeDefined();
	expect(
		root.renderer.findByTestId("onboarding-discovery-status")
	).toBeUndefined();
	expect(scan).toHaveBeenCalledTimes(1);
	expect(reader).not.toHaveBeenCalled();
});

it("scrolls all discovery results continuously above the fixed footer with bounded rows and keyboard navigation", async () => {
	const paths = Array.from(
		{ length: 3000 },
		(_, index) => `/test/project-${index}`
	);

	const scan = mock<typeof RepositoryDiscovery.scan>(async () => ({
		paths,
		scanned: 30,
		skipped: 0,
		limited: false,
	}));

	root.render(
		<App
			{...fixture()}
			initialOnboarding="repository"
			discoverRepositories={scan}
		/>
	);
	await settle();
	expect(node(`onboarding-repository-${paths[0]}`)).toBeDefined();
	expect(
		root.renderer.findByTestId(`onboarding-repository-${paths.at(-1)}`)
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("onboarding-discovery-more")
	).toBeUndefined();
	const list = node("onboarding-discovery-list");
	const viewport = node("onboarding-repositories");
	const listBounds = root.renderer.getElementBounds(list.id)!;

	const footerBounds = root.renderer.getElementBounds(
		node("onboarding-footer").id
	)!;

	expect(footerBounds.y - (listBounds.y + listBounds.height)).toBeCloseTo(
		spacing[4],
		0
	);
	root.renderer.nativeSimulateScrollWheel(
		listBounds.x + 20,
		listBounds.y + 20,
		0,
		-30_000
	);
	await settle();
	expect(root.renderer.getScrollOffset(viewport.id)?.[1]).toBeLessThan(-10_000);
	const mounted = root.renderer
		.findByType("div")
		.filter((element) =>
			element.testId?.startsWith("onboarding-repository-/test/project-")
		);

	expect(mounted.length).toBeLessThan(150);
	expect(
		root.renderer.findByTestId(`onboarding-repository-${paths[0]}`)
	).toBeUndefined();
	const first = mounted[0];

	if (!first) throw new Error("No repository row mounted after scrolling");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await settle();
	expect(node(`onboarding-repository-${paths.at(-1)}`)).toBeDefined();
	await edit("onboarding-repository-search", "project-1234");
	expect(node("onboarding-repository-/test/project-1234")).toBeDefined();
	expect(
		root.renderer.getScrollOffset(node("onboarding-repositories").id)?.[1]
	).toBeCloseTo(0);
	await edit("onboarding-repository-search", "");
	expect(node(`onboarding-repository-${paths[0]}`)).toBeDefined();
	root.renderer.nativeSimulateKeyDown(
		node(`onboarding-repository-${paths[0]}`).id,
		"end"
	);
	await settle();
	root.renderer.nativeSimulateKeyDown(
		node(`onboarding-repository-${paths.at(-1)}`).id,
		"home"
	);
	await settle();
	expect(node(`onboarding-repository-${paths[0]}`)).toBeDefined();
	expect(node("onboarding-next").customProps?.tabIndex).toBe(0);
	expect(root.renderer.getElementBounds(node("onboarding-footer").id)).toEqual(
		footerBounds
	);
});

it("acknowledges a successful identity save without automatically advancing or writing twice", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-identity-toggle");
	await edit("onboarding-name", "New Author");
	await click("onboarding-save-identity");
	expect(root.renderer.getAllText()).toContain("Git identity saved.");
	expect(root.renderer.getAllText()).toContain("2 of 4");
	await click("onboarding-save-identity");
	await click("onboarding-next");
	expect(props.writeGitSettings).toHaveBeenCalledTimes(1);
});

it("keeps unreadable identity fields protected and permits an explicit read retry", async () => {
	const props = fixture();

	const success = {
		ok: true as const,
		value: {
			identity: { name: "Existing Author", email: "existing@example.test" },
			custom: true,
			remotes: [],
		},
	};

	props.readGitSettings.mockResolvedValueOnce({
		ok: false,
		error: {
			operation: "get-config",
			code: "command-failed",
			retryable: true,
			message: "Identity unavailable",
		},
	});
	props.readGitSettings.mockResolvedValue(success);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await click("onboarding-identity-toggle");
	expect(node("onboarding-name").customProps?.readOnly).toBe(true);
	await click("onboarding-retry-identity");
	expect(node("onboarding-name").customProps?.value).toBe("Existing Author");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it("creates and opens only the explicitly chosen destination, then completes setup", async () => {
	const props = fixture();
	const setup = mock(async () => ({ ok: true as const, path: "/test/new" }));
	const picker = mock(async () => ["/test/new"]);
	const snapshot = repositorySnapshot();

	Object.assign(root.renderer, { promptForPaths: picker });
	root.render(
		<App
			{...props}
			initialOnboarding="repository"
			setupRepository={setup}
			readRepository={async () => ({
				ok: true,
				value: {
					...snapshot,
					repository: { ...snapshot.repository, root: "/test/new" },
				},
			})}
		/>
	);
	await settle();
	await click("onboarding-repository-create");
	await click("setup-location");
	expect(setup).not.toHaveBeenCalled();
	await click("setup-submit");
	expect(setup).toHaveBeenCalledWith(
		{ kind: "create", path: "/test/new", branch: "main" },
		expect.any(AbortSignal)
	);
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].onboarding).toBe("complete");
});

it("opens the existing Clone and Create forms without writing until submitted", async () => {
	const props = fixture();
	const setup = mock(async () => ({ ok: true as const, path: "/test/new" }));

	root.render(
		<App {...props} initialOnboarding="repository" setupRepository={setup} />
	);
	await settle();
	await click("onboarding-repository-clone");
	expect(node("repository-clone-view")).toBeDefined();
	await click("clone-back");
	expect(root.renderer.getAllText()).toContain("4 of 4");
	await click("onboarding-repository-create");
	expect(node("setup-branch").customProps?.value).toBe("main");
	await click("setup-cancel");
	expect(node("onboarding-view")).toBeDefined();
	expect(setup).not.toHaveBeenCalled();
});

it("leaves older sessions alone, offers replay in Settings and preserves the active draft", async () => {
	const props = fixture();

	const document: WorkspaceSessionDocument = {
		version: 1,
		appearance: "dark",
		activeId: "workspace-1",
		tabs: [
			{ id: "workspace-1", path: "/test/project", draft: "Keep this draft" },
		],
	};

	root.render(
		<App
			{...props}
			initialSession={document}
			readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
		/>
	);
	await settle();
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	spyOn(NativeFileMenu, "showItems").mockReturnValueOnce({
		kind: "settings",
		section: "accounts",
	});
	await click("rail-settings");
	await click("settings-appearance");
	root.renderer.scrollTo(node("appearance-settings-scroll").id, 0, -10000);
	await settle();
	await click("settings-run-setup");
	expect(node("onboarding-view")).toBeDefined();
	expect(node("appearance-dark").customProps?.["aria-description"]).toBe(
		"Selected"
	);
	await click("onboarding-skip");
	expect(node("commit-message").customProps?.value).toBe("Keep this draft");
	expect(node("workspace-1").customProps?.["aria-selected"]).toBe(true);
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it("resumes unfinished progress but never starts setup in sample mode", async () => {
	const props = fixture();

	const document: WorkspaceSessionDocument = {
		version: 1,
		onboarding: "git",
		activeId: null,
		tabs: [],
	};

	root.render(<App {...props} initialSession={document} />);
	await settle();
	expect(root.renderer.getAllText()).toContain("2 of 4");
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].onboarding).toBe("git");
	root.render(
		<App
			{...props}
			preview
			initialSession={document}
			initialOnboarding="welcome"
		/>
	);
	await settle();
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
});

function spacesSession(): WorkspaceSessionDocument {
	return {
		version: 1,
		onboarding: "spaces",
		activeId: null,
		tabs: [],
		activeSpaceId: "default",
		spaces: ["default", "00000000-0000-4000-8000-000000000001"].map(
			(id, index) => ({
				id,
				name: index === 0 ? "Work" : "Personal",
				icon: index === 0 ? "work" : "home",
				activeId: null,
				repositories: [],
				discovery: { folders: [], hidden: [] },
				library: { starred: [], view: "tiles" },
			})
		),
	};
}

it("can skip space setup without creating spaces or practicing a gesture", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="spaces" />);
	await settle();
	expect(root.renderer.getAllText()).toContain("3 of 4");
	expect(node("onboarding-space-edit-default")).toBeDefined();
	expect(node("onboarding-space-preset-work")).toBeDefined();
	expect(
		root.renderer.findByTestId("onboarding-space-dot-default")
	).toBeUndefined();
	expect(root.renderer.getAllText()).toContain(
		"You’ll learn how to switch after setup."
	);
	await click("onboarding-back");
	expect(root.renderer.getAllText()).toContain("Connect your accounts");
	await click("onboarding-next");
	await click("onboarding-skip");
	expect(root.renderer.getAllText()).toContain("4 of 4");
	expect(root.renderer.getAllText()).toContain("Opening in Default.");
	await click("onboarding-back");
	expect(node("onboarding-spaces")).toBeDefined();
	await click("onboarding-next");
	await click("onboarding-next");
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	root.render(<div />);
	expect(
		props.saveSession.mock.calls.at(-1)?.[0].spaces?.map((space) => space.name)
	).toEqual(["Default"]);
	expect(props.writeGitSettings).not.toHaveBeenCalled();
});

it.each(["light", "dark"] as const)(
	"edits Default and adds a preset space during %s onboarding, then resumes it",
	async (appearance) => {
		const props = fixture();

		root.render(
			<App
				{...props}
				initialOnboarding="spaces"
				initialSession={{ version: 1, tabs: [], activeId: null, appearance }}
			/>
		);
		await settle();
		await click("onboarding-space-edit-default");
		await edit("space-name", "Work");
		await click("space-icon-work");
		await click("space-editor-save");
		expect(
			node("onboarding-space-edit-default").customProps?.["aria-label"]
		).toBe("Edit Work");
		expect(
			root.renderer.findByTestId("onboarding-space-preset-work")
		).toBeUndefined();
		await click("onboarding-space-create");
		expect(root.renderer.getFocusedElementId()).toBe(node("space-name").id);
		await click("space-editor-cancel");
		await click("onboarding-space-preset-home");
		expect(root.renderer.findByTestId("space-editor")).toBeUndefined();
		expect(
			root.renderer.findByTestId("onboarding-space-preset-home")
		).toBeUndefined();
		expect(root.renderer.getAllText()).toContain("Personal");
		expect(node("onboarding-space-illustration")).toBeDefined();
		expect(root.renderer.getAllText()).toContain(
			"You’ll learn how to switch after setup."
		);

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-spaces.png`
			);

		root.render(<div />);
		const saved = props.saveSession.mock.calls.at(-1)?.[0];

		expect(saved?.onboarding).toBe("spaces");
		expect(saved?.spaces?.map(({ name, icon }) => ({ name, icon }))).toEqual([
			{ name: "Work", icon: "work" },
			{ name: "Personal", icon: "home" },
		]);
		root.render(<App {...props} initialSession={saved} />);
		await settle();
		expect(node("onboarding-spaces")).toBeDefined();
		expect(root.renderer.getAllText()).toContain("Personal");
		expect(
			node(`onboarding-space-edit-${saved?.activeSpaceId}`).customProps?.[
				"aria-label"
			]
		).toBe("Edit Personal");
		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("Opening in Personal.");
	}
);

it("opens the first repository in a newly added space after returning from repository setup", async () => {
	const props = fixture();
	const document = spacesSession();

	const reader = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	const picker = mock(async () => [] as string[]);

	Object.assign(root.renderer, { promptForPaths: picker });
	root.render(
		<App {...props} initialSession={document} readRepository={reader} />
	);
	await settle();
	await click("onboarding-next");
	await click("onboarding-open");
	expect(picker).toHaveBeenCalledTimes(1);
	await click("onboarding-back");
	await click("onboarding-space-create");
	await edit("space-name", "Project");
	await click("space-editor-save");
	await click("onboarding-next");
	Object.assign(root.renderer, {
		promptForPaths: mock(async () => ["/test/project"]),
	});
	await click("onboarding-open");
	expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	root.render(<div />);
	const saved = props.saveSession.mock.calls.at(-1)?.[0];

	const personalId = saved?.spaces?.find(
		(space) => space.name === "Project"
	)?.id;

	expect(saved?.onboarding).toBe("complete");
	expect(saved?.activeSpaceId).toBe(personalId);
	expect(saved?.tabs.find((tab) => tab.path === "/test/project")?.spaceId).toBe(
		personalId
	);
	expect(saved?.spaces?.[0]?.repositories).toEqual([]);
});

it.each(["light", "dark"] as const)(
	"keeps Spaces navigation pinned and the space preview usable at the minimum window size (%s)",
	async (appearance) => {
		root.unmount();
		root = createTestRoot({
			width: 640,
			height: 420,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		const props = fixture();

		root.render(
			<App
				{...props}
				initialSession={{
					...spacesSession(),
					appearance,
					activeSpaceId: "00000000-0000-4000-8000-000000000001",
				}}
			/>
		);
		await settle();
		await reveal("onboarding-space-illustration");
		const footer = root.renderer.getElementBounds(
			node("onboarding-footer").id
		)!;

		const content = root.renderer.getElementBounds(
			node("onboarding-content").id
		)!;

		const rail = root.renderer.getElementBounds(
			node("onboarding-space-illustration").id
		)!;

		expect(footer.y + footer.height).toBeLessThanOrEqual(420);
		expect(rail.y).toBeGreaterThanOrEqual(content.y);
		expect(rail.y + rail.height).toBeLessThanOrEqual(footer.y);

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-spaces-small.png`
			);

		await click("onboarding-space-edit-default");
		expect(root.renderer.getFocusedElementId()).toBe(node("space-name").id);
		await click("space-editor-cancel");
		await click("onboarding-skip");
		expect(root.renderer.getAllText()).toContain("Opening in Personal.");
		await click("onboarding-next");
		expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
	}
);

it("keeps the swipe hint discoverable on the space icon after setup", async () => {
	const props = fixture();

	root.render(
		<App
			{...props}
			initialSession={{ ...spacesSession(), onboarding: "complete" }}
		/>
	);
	await settle();
	const button = root.renderer.getElementBounds(node("rail-spaces").id)!;

	root.renderer.nativeSimulateMouseMove(
		button.x + button.width / 2,
		button.y + button.height / 2
	);
	await Bun.sleep(400);
	await settle();
	expect(root.renderer.getAllText().join("\n")).toContain(
		"Two-finger swipe on the rail"
	);

	if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-space-tooltip.png`
		);
});

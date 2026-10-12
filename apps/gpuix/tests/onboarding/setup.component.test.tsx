/**
 * Covers: first-run/replay setup, theme/default preservation, explicit identity saving, account return and repository success/cancellation.
 * Real: App, native setup/forms, session persistence and repository connection lifecycle.
 * Doubles: Git config/repository/setup, folder picker, hosting HTTP/vault and disposable account metadata.
 * Requires: patched native renderer and macOS graphics; no user credentials, Git writes or network.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { rmSync } from "node:fs";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import type {
	GitSettingsModel,
	GitSettingsData,
} from "../../src/feature/git-settings/git-settings-model";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let f: ReturnType<typeof hostingRepositories>;

beforeEach(() => {
	f = hostingRepositories();
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
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}
async function edit(id: string, value: string) {
	root.renderer.focusElement(node(id).id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[...value]
			.map((character) => (character === " " ? "space" : character))
			.join(" ")
	);
	await settle();
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

it.each(["light", "dark"] as const)(
	"keeps theme selection explicit, uses compact native steps and persists skipping (%s)",
	async (appearance) => {
		const props = fixture();

		root.render(<App {...props} initialOnboarding="welcome" />);
		await settle();
		expect(root.renderer.getAllText()).toContain("1 of 3");
		expect(root.renderer.getFocusedElementId()).toBe(
			node("appearance-light").id
		);
		expect(node("appearance-light").customProps?.["aria-description"]).toBe(
			"Selected"
		);
		await click(`appearance-${appearance}`);
		const screenshot = process.env.GPUIX_ONBOARDING_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-welcome.png`
			);

		await click("onboarding-next");
		expect(node("onboarding-name").customProps?.value).toBe("Existing Author");
		expect(node("onboarding-email").customProps?.value).toBe(
			"existing@example.test"
		);

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}-${appearance}-git.png`);

		await click("onboarding-next");
		expect(root.renderer.getAllText()).toContain("3 of 3");
		const footer = root.renderer.getElementBounds(
			node("onboarding-footer").id
		)!;

		expect(footer.y + footer.height).toBeLessThanOrEqual(640);
		expect(node("onboarding-repository-create")).toBeDefined();
		expect(node("onboarding-repository-clone")).toBeDefined();

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}-${appearance}-repository.png`
			);

		await click("onboarding-skip");
		expect(root.renderer.findByTestId("onboarding-view")).toBeUndefined();
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

it("returns from optional Accounts and Back without saving or losing identity edits", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await edit("onboarding-name", "Draft Author");
	await click("onboarding-accounts");
	expect(node("account-setup-panel")).toBeDefined();
	await click("settings-title-tab-close");
	expect(root.renderer.getAllText()).toContain("2 of 3");
	expect(node("onboarding-name").customProps?.value).toBe("Draft Author");
	await click("onboarding-back");
	await click("onboarding-next");
	expect(node("onboarding-name").customProps?.value).toBe("Draft Author");
	await click("onboarding-next");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
	expect(f.requests).toHaveLength(0);
});

it("validates and saves identity only on explicit Save, blocks duplicate writes and rereads failure", async () => {
	const props = fixture();

	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof GitSettingsModel.write>>>();

	props.writeGitSettings.mockImplementation(() => pending.promise);
	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await edit("onboarding-email", "bad-email");
	await click("onboarding-save-identity");
	expect(props.writeGitSettings).not.toHaveBeenCalled();
	expect(node("onboarding-identity-error")).toBeDefined();
	await edit("onboarding-email", "new@example.test");
	await click("onboarding-save-identity");
	await click("onboarding-save-identity");
	await click("onboarding-next");
	await click("onboarding-skip");
	expect(props.writeGitSettings).toHaveBeenCalledTimes(1);
	expect(props.writeGitSettings).toHaveBeenCalledWith(null, {
		kind: "identity",
		custom: true,
		identity: { name: "Existing Author", email: "new@example.test" },
	});
	expect(root.renderer.getAllText()).toContain("2 of 3");
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

it("acknowledges a successful identity save without automatically advancing or writing twice", async () => {
	const props = fixture();

	root.render(<App {...props} initialOnboarding="git" />);
	await settle();
	await edit("onboarding-name", "New Author");
	await click("onboarding-save-identity");
	expect(root.renderer.getAllText()).toContain("Git identity saved.");
	expect(root.renderer.getAllText()).toContain("2 of 3");
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
	expect(root.renderer.getAllText()).toContain("3 of 3");
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
	await click("rail-settings");
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
	expect(root.renderer.getAllText()).toContain("2 of 3");
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

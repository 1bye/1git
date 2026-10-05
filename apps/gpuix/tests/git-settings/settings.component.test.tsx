/**
 * Covers: global identity, repository overrides, explicit remote saves/removal, failures and workspace locks.
 * Real: App/settings components, reducer, native controls, layout and keyboard.
 * Doubles: Git reads/writes and path picker; never modifies a user's Git config or contacts a remote.
 * Requires: built native addon and graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
import { GitSettings } from "../../src/feature/git-settings/git-settings";
import {
	GitSettingsModel,
	type GitSettingsData,
} from "../../src/feature/git-settings/git-settings-model";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let data: GitSettingsData;
const read = mock<typeof GitSettingsModel.read>();
const write = mock<typeof GitSettingsModel.write>();

const origin = {
	name: "origin",
	fetchUrls: ["https://example.invalid/repo.git"],
	pushUrls: ["https://example.invalid/repo.git"],
	defaultBranch: "main",
};

beforeEach(() => {
	data = {
		identity: { name: "Personal", email: "personal@example.invalid" },
		custom: false,
		remotes: [origin],
	};
	read.mockReset();
	write.mockReset();
	read.mockImplementation(async () => ({ ok: true, value: data }));
	write.mockImplementation(async (_root, request) => {
		if (request.kind === "identity")
			data = {
				...data,
				custom: request.custom,
				identity: request.custom
					? request.identity
					: { name: "Personal", email: "personal@example.invalid" },
			};
		else if (request.kind === "add-remote")
			data = {
				...data,
				remotes: [
					...data.remotes,
					{
						...origin,
						name: request.name,
						fetchUrls: [request.url],
						pushUrls: [request.url],
					},
				],
			};
		else if (request.kind === "edit-remote")
			data = {
				...data,
				remotes: data.remotes.map((remote) =>
					remote.name === request.name
						? { ...remote, fetchUrls: [request.url] }
						: remote
				),
			};
		else
			data = {
				...data,
				remotes: data.remotes.filter((remote) => remote.name !== request.name),
			};

		return { ok: true, value: data };
	});
	root = createTestRoot({
		width: 980,
		height: 820,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

async function settle() {
	root.renderer.flush();
	await Bun.sleep(80);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	await Bun.sleep(0);
	root.renderer.flush();
}
function node(id: string) {
	const result = root.renderer.findByTestId(id);

	if (!result) throw new Error(`Missing ${id}`);

	return result;
}
async function click(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	const scroll = root.renderer.findByTestId("git-settings-scroll");

	if (scroll) {
		const viewport = root.renderer.getElementBounds(scroll.id);

		if (viewport && bounds.y + bounds.height > viewport.y + viewport.height) {
			const offset = root.renderer.getScrollOffset(scroll.id)?.[1] ?? 0;

			root.renderer.scrollTo(
				scroll.id,
				0,
				offset - (bounds.y + bounds.height - viewport.y - viewport.height) - 8
			);
			await settle();
		}
	}

	const current = root.renderer.getElementBounds(node(id).id);

	if (!current) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		current.x + current.width / 2,
		current.y + current.height / 2
	);
	await settle();
}
async function type(id: string, value: string) {
	await click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...value].join(" "));
	await settle();
}

it("opens Git in app Settings and saves a computer-wide identity only on explicit Save", async () => {
	data = { ...data, custom: true };
	root.render(<App readGitSettings={read} writeGitSettings={write} />);
	await settle();
	await click("rail-settings");
	await click("settings-git");
	expect(
		root.renderer.findByTestId("settings-repository-group")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("settings-repository-remotes")
	).toBeUndefined();
	expect(
		root.renderer.findByTestId("settings-repository-identity")
	).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain(
		"Default commit identity. Applies across this computer, including other Git apps."
	);
	expect(root.renderer.findByTestId("identity-preview")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
	await type("identity-name", "Work");
	await type("identity-email", "work@example.invalid");
	expect(write).not.toHaveBeenCalled();
	await click("identity-save");
	expect(write).toHaveBeenCalledWith(null, {
		kind: "identity",
		custom: true,
		identity: { name: "Work", email: "work@example.invalid" },
	});
	expect(root.renderer.getAllText()).toContain("Identity saved.");

	if (process.env.GPUIX_GIT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GIT_SETTINGS_SCREENSHOT}-global.png`
		);

	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("git-settings")).toBeUndefined();
});

it("uses inherited identity until selected, saves an override, and can return to Git defaults", async () => {
	root.render(
		<AccountsSettings
			onBack={() => {}}
			initialSection="repository-identity"
			repositorySettings={{
				root: "/test/project",
				name: "Project",
				disabled: false,
			}}
			readGitSettings={read}
			writeGitSettings={write}
		/>
	);
	await settle();
	expect(node("identity-name").customProps?.readOnly).toBe(true);
	await click("identity-custom");
	await type("identity-name", "Work");
	await click("identity-save");
	expect(write).toHaveBeenCalledWith("/test/project", {
		kind: "identity",
		custom: true,
		identity: { name: "Work", email: "personal@example.invalid" },
	});
	await click("identity-custom");
	expect(node("identity-name").customProps?.readOnly).toBe(true);
	await click("identity-save");
	expect(data.custom).toBe(false);
	expect(node("identity-name").customProps?.readOnly).toBe(true);

	if (process.env.GPUIX_GIT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GIT_SETTINGS_SCREENSHOT}-repository.png`
		);
});

it("adds and edits remotes explicitly and requires confirmation to remove them", async () => {
	root.render(
		<GitSettings
			page="remotes"
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	await click("remote-add");
	await type("remote-name", "upstream");
	await type("remote-url", "https://example.invalid/upstream.git");
	expect(write).not.toHaveBeenCalled();
	await click("remote-save");
	expect(data.remotes).toHaveLength(2);
	await click("remote-edit-origin");
	await type("remote-url", "git@example.invalid:repo.git");
	await click("remote-save");
	expect(write).toHaveBeenLastCalledWith("/test/project", {
		kind: "edit-remote",
		name: "origin",
		url: "git@example.invalid:repo.git",
	});
	await click("remote-remove-origin");
	expect(root.renderer.findByTestId("remote-remove-dialog")).toBeDefined();
	await click("remote-remove-cancel");
	expect(data.remotes).toHaveLength(2);
	await click("remote-remove-origin");
	await click("remote-remove-confirm");
	expect(data.remotes.map((remote) => remote.name)).toEqual(["upstream"]);
});

it("retains failures, rereads partial saves and leaves a multi-URL remote unchanged", async () => {
	data = {
		...data,
		custom: true,
		remotes: [
			{
				...origin,
				fetchUrls: [
					"https://example.invalid/one.git",
					"https://example.invalid/two.git",
				],
			},
		],
	};
	write.mockImplementation(async () => {
		data = {
			...data,
			identity: { name: "Partially saved", email: "personal@example.invalid" },
		};

		return {
			ok: false,
			error: {
				code: "permission-denied",
				operation: "set-config",
				retryable: false,
				message: "Could not save email.",
			},
		};
	});
	root.render(
		<GitSettings
			key="remotes"
			page="remotes"
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	await click("remote-edit-origin");
	expect(root.renderer.findByTestId("remote-editor")).toBeUndefined();
	root.render(
		<GitSettings
			key="identity"
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	await type("identity-name", "Changed");
	await click("identity-save");
	expect(root.renderer.getAllText()).toContain(
		"Could not save email. Check the saved settings before retrying."
	);
	expect(node("identity-name").customProps?.value).toBe("Partially saved");
	expect(read.mock.calls.length).toBeGreaterThan(1);
});

it("opens repository settings from its tab, blocks duplicate saves and Escape until completion, and preserves the draft", async () => {
	const snapshot = repositorySnapshot([changedFile("file.txt")]);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	let release: (() => void) | undefined;

	write.mockImplementation(async (_path, request) => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});

		if (request.kind === "identity")
			data = { ...data, custom: true, identity: request.identity };

		return { ok: true, value: data };
	});
	root.render(
		<App
			readRepository={async () => ({ ok: true, value: snapshot })}
			readBranches={async () => ({
				ok: true,
				value: {
					branches: { branches: [], current: "main" },
					worktrees: [],
					remotes: [],
				},
			})}
			readGitSettings={read}
			writeGitSettings={write}
		/>
	);
	await settle();
	await click("open-repository");
	await type("commit-message", "draft");
	await click("workspace-1");
	await click("repository-settings");
	expect(root.renderer.findByTestId("workspace-menu")).toBeUndefined();
	expect(root.renderer.findByTestId("remote-add")).toBeDefined();
	expect(root.renderer.findByTestId("identity-name")).toBeUndefined();
	await click("settings-repository-identity");
	await click("identity-custom");
	await type("identity-name", "Work");
	await click("identity-save");
	await click("identity-save");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("repository-settings")).toBeDefined();
	await click("settings-repository-remotes");
	expect(root.renderer.findByTestId("identity-name")).toBeDefined();

	if (!release) throw new Error("Save not pending");

	release();
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("draft");
});

it("keeps worktree-specific identities read-only while allowing remote management", async () => {
	data = {
		...data,
		custom: true,
		identityReadOnlyReason: "Worktree identity requires Git directly.",
	};
	root.render(
		<GitSettings
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	expect(node("identity-name").customProps?.readOnly).toBe(true);
	expect(root.renderer.getAllText()).toContain(
		"Worktree identity requires Git directly."
	);
	await click("identity-save");
	expect(write).not.toHaveBeenCalled();
	root.render(
		<GitSettings
			key="remotes"
			page="remotes"
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	await click("remote-add");
	expect(root.renderer.findByTestId("remote-editor")).toBeDefined();
});

it("shows a read failure without exposing writable fields", async () => {
	read.mockImplementation(async () => ({
		ok: false,
		error: {
			code: "permission-denied",
			operation: "get-config",
			retryable: false,
			message: "Cannot read configuration.",
		},
	}));
	root.render(
		<GitSettings
			root="/test/project"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Cannot read configuration.");
	expect(root.renderer.findByTestId("identity-save")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
});

it("reports a successful config save with a failed repository refresh without losing the draft", async () => {
	const snapshot = repositorySnapshot([changedFile("file.txt")]);

	const readRepository = mock(async () => ({
		ok: true as const,
		value: snapshot,
	}));

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App
			readRepository={readRepository}
			readGitSettings={read}
			writeGitSettings={write}
		/>
	);
	await settle();
	await click("open-repository");
	await type("commit-message", "draft");
	await click("rail-settings");
	await click("settings-repository-identity");
	readRepository.mockImplementation(async () => {
		throw new Error("Refresh failed");
	});
	await click("identity-custom");
	await type("identity-name", "Work");
	await click("identity-save");
	expect(write).toHaveBeenCalledTimes(1);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Settings were saved, but the repository could not be refreshed."
	);
	expect(node("identity-name").customProps?.value).toBe("Work");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("draft");
});

it("never falls back to writable global settings when the repository is unavailable", async () => {
	root.render(
		<AccountsSettings
			onBack={() => {}}
			initialSection="repository-identity"
			readGitSettings={read}
			writeGitSettings={write}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Open a repository to edit its settings"
	);
	expect(root.renderer.findByTestId("identity-save")).toBeUndefined();
	expect(read).not.toHaveBeenCalled();
	expect(write).not.toHaveBeenCalled();
});

it("groups application and repository pages with compact padding and no repository name in navigation", async () => {
	root.render(
		<AccountsSettings
			onBack={() => {}}
			initialSection="git"
			repositorySettings={{
				root: "/test/project",
				name: "Project",
				disabled: false,
			}}
			readGitSettings={read}
			writeGitSettings={write}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Application");
	expect(
		root.renderer.findByTestId("settings-repository-name")
	).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Project");
	const navigation = root.renderer.getElementBounds(
		node("settings-navigation").id
	);

	const accounts = root.renderer.getElementBounds(node("settings-accounts").id);

	if (!navigation || !accounts) throw new Error("Missing navigation bounds");

	expect(accounts.x - navigation.x).toBeCloseTo(8, 1);
	expect(root.renderer.findByTestId("identity-name")).toBeDefined();
	expect(root.renderer.findByTestId("remote-add")).toBeUndefined();
	expect(read.mock.calls.at(-1)?.[0]).toBeNull();
	await click("settings-repository-remotes");
	expect(root.renderer.findByTestId("remote-add")).toBeDefined();
	expect(root.renderer.findByTestId("identity-name")).toBeUndefined();
	expect(read.mock.calls.at(-1)?.[0]).toBe("/test/project");

	if (process.env.GPUIX_GIT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GIT_SETTINGS_SCREENSHOT}-remotes.png`
		);

	await click("settings-repository-identity");
	expect(root.renderer.findByTestId("identity-name")).toBeDefined();
	expect(root.renderer.findByTestId("remote-add")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Use default identity");
	expect(read.mock.calls.at(-1)?.[0]).toBe("/test/project");
	await click("settings-git");
	expect(read.mock.calls.at(-1)?.[0]).toBeNull();
	expect(root.renderer.findByTestId("identity-custom")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();

	if (process.env.GPUIX_GIT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GIT_SETTINGS_SCREENSHOT}-application.png`
		);
});

it("keeps identity pages concise and groups Add remote with the Remotes heading", async () => {
	root.render(
		<GitSettings root={null} read={read} write={write} onBusy={() => {}} />
	);
	await settle();

	for (const pageRoot of [null, "/test/project"]) {
		root.render(
			<GitSettings
				key={pageRoot ?? "global"}
				root={pageRoot}
				read={read}
				write={write}
				onBusy={() => {}}
			/>
		);
		await settle();
		const text = root.renderer.getAllText().join(" ");

		expect(text).not.toMatch(
			/GitHub login|noreply|New commits:|linked worktrees|other Git apps/
		);
		expect(text).toContain("Name");
		expect(text).toContain("Commit email");
		expect(root.renderer.findByTestId("identity-preview")).toBeUndefined();
	}

	data = { ...data, remotes: [] };
	root.render(
		<GitSettings
			key="remotes"
			root="/test/project"
			page="remotes"
			read={read}
			write={write}
			onBusy={() => {}}
		/>
	);
	await settle();
	const titleBounds = root.renderer.getElementBounds(
		node("git-settings-heading").id
	);

	const addBounds = root.renderer.getElementBounds(node("remote-add").id);

	if (!titleBounds || !addBounds)
		throw new Error("Missing Remotes header bounds");

	expect(titleBounds.y + titleBounds.height / 2).toBeCloseTo(
		addBounds.y + addBounds.height / 2,
		1
	);
	expect(addBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);
	expect(root.renderer.getAllText().join(" ")).not.toMatch(
		/fetches and pushes|linked worktrees/
	);
	expect(root.renderer.findByTestId("remotes-empty")).toBeDefined();

	if (process.env.GPUIX_GIT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_GIT_SETTINGS_SCREENSHOT}-empty-remotes.png`
		);

	await click("remote-add");
	expect(root.renderer.findByTestId("remote-url")).toBeDefined();
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"without passwords or access tokens"
	);
	expect(write).not.toHaveBeenCalled();
});

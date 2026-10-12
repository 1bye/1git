/**
 * Covers: Accounts-style AI setup, multiple identities/defaults, cancel/remove, model loading, masked keys and commit drafts.
 * Real: native UI, connection service, SDK boundaries and disposable settings files.
 * Doubles: OS vault, model catalog, browser authorization, inference and selected Git diff.
 * Requires: built native addon and macOS graphics; no network or real credentials.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { AiProvider } from "../../src/feature/ai/ai-provider";
import { AiSettings } from "../../src/feature/ai/ai-settings";
import { AiCommitButton } from "../../src/feature/ai/ai-commit-button";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { cavemanCommitPreset } from "../../src/feature/ai/lib/caveman-commit-preset";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiConnection,
} from "../../src/feature/ai/lib/ai-settings-store";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let directory: string;
let service: AiIntegration;
let credentials: Map<string, string>;

const configured: AiConnection = {
	...emptyAiPreferences,
	id: "11111111-1111-4111-8111-111111111111",
	label: "Personal",
	provider: "opencode",
	model: "big-pickle",
};

const choices = [
	{ value: "big-pickle", label: "Big Pickle" },
	{ value: "step-5-preview-free", label: "Step Free" },
];

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-ai-ui-"));
	credentials = new Map();
	service = new AiIntegration(new AiSettingsStore(join(directory, "ai.json")), {
		read: async (key) => credentials.get(key) ?? null,
		write: async (key, value) => {
			credentials.set(key, value);
		},
		delete: async (key) => {
			credentials.delete(key);
		},
	});
	spyOn(service, "models").mockResolvedValue(choices);
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
	rmSync(directory, { recursive: true, force: true });
});

function node(id: string) {
	const result = root.renderer.findByTestId(id);

	if (!result) throw new Error(`Missing ${id}`);

	return result;
}
async function settle() {
	for (let pass = 0; pass < 5; pass++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}

	root.renderer.clockFastForward(200);
	root.renderer.flush();
}
async function press(id: string) {
	const scroll = root.renderer.findByTestId("ai-settings-scroll");
	let ancestor = node(id);

	while (ancestor.parentId && ancestor.id !== scroll?.id) {
		const parent = root.renderer.getElement(ancestor.parentId);

		if (!parent) break;

		ancestor = parent;
	}

	if (scroll && ancestor.id === scroll.id) {
		for (let pass = 0; pass < 8; pass++) {
			const viewport = root.renderer.getElementBounds(scroll.id)!;
			const bounds = root.renderer.getElementBounds(node(id).id)!;
			const center = bounds.y + bounds.height / 2;

			if (center >= viewport.y && center <= viewport.y + viewport.height) break;

			root.renderer.nativeSimulateScrollWheel(
				viewport.x + viewport.width - 8,
				viewport.y + 40,
				0,
				center < viewport.y ? 240 : -240
			);
			await settle();
		}
	}

	const bounds = root.renderer.getElementBounds(node(id).id)!;

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
	await settle();
}
async function type(id: string, value: string) {
	await press(id);
	root.renderer.simulateKeystrokes(`cmd-a ${value.split("").join(" ")}`);
	await settle();
}
function configure() {
	service.store.save({ connections: [configured], defaultId: configured.id });
}
function workspace() {
	return {
		...RepositoryWorkspaceModel.reduce(RepositoryWorkspaceModel.create(), {
			type: "loaded",
			snapshot: repositorySnapshot([changedFile("selected.ts")]),
		}),
		commitMessage: "Existing draft",
	};
}
function settings() {
	root.render(
		<AiProvider service={service}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					height: "100%",
					minHeight: 0,
				}}
			>
				<AiSettings openLink={async () => undefined} />
			</div>
		</AiProvider>
	);
}
async function addFree(label: string, makeDefault = false) {
	await press("ai-add");
	await type("ai-account-name", label);
	await press("ai-model");
	root.renderer.simulateKeystrokes("down enter");
	await settle();

	if (makeDefault) await press("ai-use-default");

	await press("ai-save-preferences");

	return service.store.load().connections.find((item) => item.label === label)!;
}

it.each(["light", "dark"] as const)(
	"shows the account list and matching split setup with a pinned footer (%s)",
	async (appearance) => {
		root.render(
			<App
				ai={service}
				initialSession={{ version: 1, tabs: [], activeId: null, appearance }}
			/>
		);
		await settle();
		await press("rail-settings");
		await press("settings-ai");
		expect(node("ai-empty")).toBeDefined();
		expect(root.renderer.findByTestId("ai-list-footer")).toBeUndefined();
		expect(service.models).not.toHaveBeenCalled();
		await press("ai-add");
		expect(node("ai-setup-panel")).toBeDefined();
		expect(service.models).toHaveBeenCalledTimes(1);
		expect(node("ai-instructions").customProps?.value).toBe("");
		const instructions = root.renderer.getElementBounds(
			node("ai-instructions").id
		)!;

		const preset = root.renderer.getElementBounds(
			node("ai-preset-caveman-commit").id
		)!;

		const defaultChoice = root.renderer.getElementBounds(
			node("ai-use-default").id
		)!;

		if (process.env.GPUIX_AI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_SCREENSHOT}-${appearance}-link.png`
			);

		expect(preset.y).toBeGreaterThanOrEqual(
			instructions.y + instructions.height
		);
		expect(preset.y - instructions.y - instructions.height).toBeLessThanOrEqual(
			8
		);
		expect(root.renderer.getAllText()).toContain("Preset: caveman-commit");
		expect(preset.x).toBe(
			root.renderer.getElementBounds(node("ai-provider-opencode").id)!.x
		);
		expect(preset.y + preset.height).toBeLessThanOrEqual(defaultChoice.y);
		expect(root.renderer.findByTestId("ai-api-key")).toBeUndefined();
		const providerTile = root.renderer.getElementBounds(
			node("ai-provider-opencode").id
		)!;

		const freeTile = root.renderer.getElementBounds(node("ai-mode-free").id)!;
		const goTile = root.renderer.getElementBounds(node("ai-mode-go").id)!;
		const zenTile = root.renderer.getElementBounds(node("ai-mode-zen").id)!;

		for (const plan of ["free", "go", "zen"])
			expect(node(`ai-mode-${plan}-icon`)).toBeDefined();

		expect(freeTile.height).toBe(providerTile.height);
		expect(goTile.height).toBe(freeTile.height);
		expect(zenTile.height).toBe(freeTile.height);
		expect(Math.abs(freeTile.width - goTile.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(goTile.width - zenTile.width)).toBeLessThanOrEqual(1);
		const left = root.renderer.getElementBounds(node("ai-list-panel").id)!;
		const right = root.renderer.getElementBounds(node("ai-setup-panel").id)!;

		expect(left.width).toBe(right.width);
		expect(right.x).toBe(left.x + left.width);
		const footer = root.renderer.getElementBounds(
			node("ai-settings-footer").id
		)!;

		expect(footer.y + footer.height).toBe(right.y + right.height);

		if (process.env.GPUIX_AI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_SCREENSHOT}-${appearance}-setup.png`
			);

		await press("ai-cancel-editor");
		expect(service.store.load().connections).toHaveLength(0);
		expect(service.store.load().defaultId).toBeNull();

		const work = {
			...configured,
			id: "22222222-2222-4222-8222-222222222222",
			label: "Work",
		};

		service.store.save({
			connections: [configured, work],
			defaultId: configured.id,
		});
		root.render(
			<App
				key="saved-accounts"
				ai={service}
				initialSession={{ version: 1, tabs: [], activeId: null, appearance }}
			/>
		);
		await settle();
		await press("rail-settings");
		await press("settings-ai");
		const turnOff = root.renderer.getElementBounds(node("ai-provider-off").id)!;
		const add = root.renderer.getElementBounds(node("ai-add").id)!;

		expect(turnOff.y).toBe(add.y);
		expect(turnOff.x + turnOff.width + 4).toBe(add.x);
		await press(`ai-edit-${work.id}`);
		expect(node(`ai-default-badge-${configured.id}`)).toBeDefined();
		const list = root.renderer.getElementBounds(node("ai-list-panel").id)!;

		const listScroll = root.renderer.getElementBounds(
			node("ai-list-scroll").id
		)!;

		expect(listScroll.y + listScroll.height).toBe(list.y + list.height);
		expect(root.renderer.findByTestId("ai-default-status")).toBeUndefined();

		const remove = root.renderer.getElementBounds(
			node(`ai-remove-${work.id}`).id
		)!;

		expect(remove.x + remove.width).toBeLessThanOrEqual(list.x + list.width);
		await press("ai-preset-caveman-commit");
		expect(node("ai-instructions").customProps?.value).toBe(
			cavemanCommitPreset
		);
		const save = root.renderer.getElementBounds(
			node("ai-save-preferences").id
		)!;

		expect(save.y + save.height).toBeLessThanOrEqual(720);

		if (process.env.GPUIX_AI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_SCREENSHOT}-${appearance}-saved.png`
			);

		await press("ai-cancel-editor");
		expect(service.store.load().defaultId).toBe(configured.id);
		expect(root.renderer.findByTestId("ai-setup-panel")).toBeUndefined();
	}
);

it("selects matching OpenCode plan tiles with mouse, Enter and Space without saving a draft", async () => {
	settings();
	await settle();
	await press("ai-add");
	await press("ai-mode-go");
	expect(node("ai-api-key")).toBeDefined();

	root.renderer.nativeSimulateKeyDown(node("ai-mode-free").id, "space");
	root.renderer.nativeSimulateKeyUp(node("ai-mode-free").id, "space");
	await settle();
	expect(root.renderer.findByTestId("ai-api-key")).toBeUndefined();
	root.renderer.focusElement(node("ai-mode-zen").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(node("ai-api-key")).toBeDefined();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Generation may incur charges."
	);
	expect(JSON.stringify(root.renderer.getA11yTree())).toContain(
		"Selected OpenCode plan"
	);
	expect(service.store.load().connections).toHaveLength(0);
});

it("adds multiple Free profiles, explicitly selects a default and preserves independent instructions on edit/cancel", async () => {
	settings();
	await settle();
	const first = await addFree("Personal", true);
	const second = await addFree("Work");

	expect(service.store.load().connections).toHaveLength(2);
	expect(service.store.load().defaultId).toBe(first.id);
	expect(node(`ai-default-badge-${first.id}`)).toBeDefined();
	await press(`ai-edit-${second.id}`);
	await type("ai-instructions", "Work");
	expect(service.models).toHaveBeenCalledTimes(3);
	await press("ai-cancel-editor");
	expect(
		service.store.load().connections.find((item) => item.id === second.id)
			?.instructions
	).toBe("");
	await press(`ai-edit-${second.id}`);
	await type("ai-instructions", "Work");
	await press("ai-save-preferences");
	expect(
		service.store.load().connections.find((item) => item.id === second.id)
			?.instructions
	).toBe("Work");
	expect(
		service.store.load().connections.find((item) => item.id === first.id)
			?.instructions
	).toBe("");
	await press(`ai-default-${second.id}`);
	expect(service.store.load().defaultId).toBe(second.id);
	await press("ai-provider-off");
	expect(service.store.load().defaultId).toBeNull();
	expect(service.store.load().connections).toHaveLength(2);
});

it("applies caveman-commit only to the editable draft until saved, preserving other accounts and the default", async () => {
	const personal = { ...configured, instructions: "Existing instructions" };

	const work = {
		...configured,
		id: "22222222-2222-4222-8222-222222222222",
		label: "Work",
		instructions: "Work instructions",
	};

	const saved = { connections: [personal, work], defaultId: personal.id };

	service.store.save(saved);
	settings();
	await settle();
	await press(`ai-edit-${work.id}`);
	expect(node("ai-instructions").customProps?.value).toBe(work.instructions);
	await press("ai-preset-caveman-commit");
	expect(node("ai-instructions").customProps?.value).toBe(cavemanCommitPreset);
	expect(service.models).toHaveBeenCalledTimes(1);
	expect(service.store.load()).toEqual(saved);
	await press("ai-cancel-editor");
	expect(service.store.load()).toEqual(saved);
	expect(root.renderer.findByTestId("ai-setup-panel")).toBeUndefined();

	await press(`ai-edit-${work.id}`);
	await press("ai-preset-caveman-commit");
	await type("ai-instructions", "Custom");
	expect(node("ai-instructions").customProps?.value).toBe("Custom");
	root.renderer.focusElement(node("ai-preset-caveman-commit").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(node("ai-instructions").customProps?.value).toBe(cavemanCommitPreset);
	expect(service.models).toHaveBeenCalledTimes(2);
	await press("ai-save-preferences");
	expect(service.store.load()).toEqual({
		...saved,
		connections: [personal, { ...work, instructions: cavemanCommitPreset }],
	});
	await press(`ai-edit-${work.id}`);
	expect(node("ai-instructions").customProps?.value).toBe(cavemanCommitPreset);
});

it("adds separate OpenCode keys and keeps key fields hidden in Free", async () => {
	settings();
	await settle();

	for (const [label, key] of [
		["Personal", "personal"],
		["Work", "work"],
	]) {
		await press("ai-add");
		await type("ai-account-name", label!);
		await press("ai-mode-go");
		await type("ai-api-key", key!);
		expect(node("ai-api-key").customProps?.type).toBe("password");
		expect(node("ai-api-key").customProps?.value).toBeUndefined();
		await press("ai-save-key");
		await press("ai-model");
		root.renderer.simulateKeystrokes("down enter");
		await settle();
		await press("ai-save-preferences");
	}

	expect(credentials.size).toBe(2);
	expect([...credentials.values()].sort()).toEqual(["personal", "work"]);
	const connection = service.store.load().connections[0]!;

	await press(`ai-edit-${connection.id}`);
	await press("ai-replace-key");
	await type("ai-api-key", "unsaved");
	await press("ai-mode-free");
	expect(root.renderer.findByTestId("ai-api-key")).toBeUndefined();
	await press("ai-mode-go");
	expect(root.renderer.findByTestId("ai-api-key")).toBeUndefined();
	await press("ai-cancel-editor");
	expect([...credentials.values()].sort()).toEqual(["personal", "work"]);
});

it("removes only the confirmed account, and clears the default without selecting another", async () => {
	settings();
	await settle();
	const first = await addFree("Personal", true);
	const second = await addFree("Work");

	await press(`ai-remove-${first.id}`);
	expect(node("ai-disconnect-confirmation")).toBeDefined();
	await press("ai-disconnect-cancel");
	root.renderer.advanceTime(1);
	await Bun.sleep(120);
	root.renderer.flush();
	expect(service.store.load().connections).toHaveLength(2);
	await press(`ai-remove-${first.id}`);
	await press("ai-disconnect-confirm");
	expect(service.store.load().defaultId).toBeNull();
	expect(service.store.load().connections.map((item) => item.id)).toEqual([
		second.id,
	]);
	const notice = root.renderer.getElementBounds(node("ai-list-notice").id)!;
	const listScroll = root.renderer.getElementBounds(node("ai-list-scroll").id)!;

	expect(notice.y + notice.height).toBeLessThanOrEqual(listScroll.y);
});

it("adds two ChatGPT accounts without overwriting either identity or the default", async () => {
	let count = 0;

	spyOn(service.authorization, "connect").mockImplementation(async () => {
		const index = ++count;

		const account = {
			clientId: `oaiapp_${index}`,
			subject: `subject${index}`,
			email: `${index}@example.invalid`,
		};

		return {
			account,
			session: {
				...account,
				accessToken: `access${index}`,
				refreshToken: `refresh${index}`,
				idToken: "identity",
				scope: "resource.invoke chatgpt.tokens.use.direct",
				expiresAt: Date.now() + 3600000,
			},
		};
	});
	settings();
	await settle();

	for (const label of ["Personal", "Work"]) {
		await press("ai-add");
		await press("ai-provider-chatgpt");
		await type("ai-account-name", label);
		await press("ai-chatgpt-connect");
		await press("ai-model");
		root.renderer.simulateKeystrokes("down enter");
		await settle();

		if (label === "Personal") await press("ai-use-default");

		await press("ai-save-preferences");
	}

	const configuration = service.store.load();

	expect(configuration.connections).toHaveLength(2);
	expect(credentials.size).toBe(2);
	expect(
		configuration.connections.map((item) => item.chatgpt?.email).sort()
	).toEqual(["1@example.invalid", "2@example.invalid"]);
	expect(configuration.defaultId).toBe(
		configuration.connections.find((item) => item.label === "Personal")?.id ??
			null
	);
});

it("cancels stale catalogs on plan changes and retries catalog failures", async () => {
	const obsolete = Promise.withResolvers<typeof choices>();
	let signal: AbortSignal | undefined;

	const models = spyOn(service, "models")
		.mockImplementationOnce(async (_preferences, next) => {
			signal = next;

			return await obsolete.promise;
		})
		.mockRejectedValueOnce(new Error("Model service unavailable"))
		.mockResolvedValue(choices);

	settings();
	await settle();
	await press("ai-add");
	await press("ai-mode-go");
	expect(signal?.aborted).toBe(true);
	obsolete.resolve([{ value: "obsolete", label: "Obsolete model" }]);
	await settle();
	await press("ai-mode-free");
	expect(node("ai-models-error")).toBeDefined();
	await press("ai-models-retry");
	expect(models).toHaveBeenCalledTimes(3);
	await press("ai-model");
	expect(root.renderer.getAllText()).not.toContain("Obsolete model");
	root.renderer.simulateKeystrokes("escape");
	await settle();
});

it("keeps setup actions pinned at minimum height while scrolling only the form", async () => {
	root.unmount();
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	root.render(
		<App
			ai={service}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				appearance: "dark",
			}}
		/>
	);
	await settle();
	await press("rail-settings");
	await press("settings-ai");
	await press("ai-add");
	await press("ai-mode-go");
	const scroll = node("ai-settings-scroll");
	const bounds = root.renderer.getElementBounds(scroll.id)!;
	const save = root.renderer.getElementBounds(node("ai-save-preferences").id)!;

	const provider = root.renderer.getElementBounds(
		node("ai-provider-opencode").id
	)!;

	expect(save.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
	expect(save.y + save.height).toBeLessThanOrEqual(640);

	if (process.env.GPUIX_AI_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_AI_SCREENSHOT}-minimum.png`
		);

	root.renderer.nativeSimulateScrollWheel(
		provider.x + provider.width / 2,
		provider.y + provider.height / 2,
		0,
		-300
	);
	await settle();
	expect(root.renderer.getScrollOffset(scroll.id)?.[1]).toBeLessThan(0);
	expect(
		root.renderer.getElementBounds(node("ai-save-preferences").id)
	).toEqual(save);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("ai-setup-panel")).toBeUndefined();
	expect(node("ai-settings")).toBeDefined();
});

it("generates with the selected default's preferences and applies only after confirmation", async () => {
	configure();
	const generated = spyOn(service, "generate").mockResolvedValue(
		"fix: checked changes"
	);

	const read = mock(async () => "+selected");
	const applied = mock();

	root.render(
		<AiProvider service={service}>
			<AiCommitButton state={workspace()} read={read} onMessage={applied} />
		</AiProvider>
	);
	await settle();
	await press("ai-generate");
	expect(generated).not.toHaveBeenCalled();
	await press("ai-commit-request");
	expect(generated).toHaveBeenCalledWith(
		expect.objectContaining({ id: configured.id, model: configured.model }),
		"+selected",
		expect.any(AbortSignal),
		expect.any(Function)
	);
	expect(applied).not.toHaveBeenCalled();
	await press("ai-commit-use");
	expect(applied).toHaveBeenCalledWith("fix: checked changes");
	expect(read).toHaveBeenCalledTimes(2);
});

it("does not apply a suggestion after selected changes on disk move", async () => {
	configure();
	spyOn(service, "generate").mockResolvedValue("fix: old changes");
	let patch = "+old";
	const applied = mock();

	root.render(
		<AiProvider service={service}>
			<AiCommitButton
				state={workspace()}
				read={async () => patch}
				onMessage={applied}
			/>
		</AiProvider>
	);
	await settle();
	await press("ai-generate");
	await press("ai-commit-request");
	patch = "+new";
	await press("ai-commit-use");
	expect(applied).not.toHaveBeenCalled();
	expect(node("ai-commit-status").customProps?.role).toBe("alert");
});

it("cancels a pending suggestion after a manual draft edit and ignores its late result", async () => {
	configure();
	const completion = Promise.withResolvers<string>();
	let signal: AbortSignal | undefined;
	const applied = mock();
	const state = workspace();

	spyOn(service, "generate").mockImplementation(
		async (_preferences, _patch, next) => {
			signal = next;

			return await completion.promise;
		}
	);
	const render = (draft: string) =>
		root.render(
			<AiProvider service={service}>
				<AiCommitButton
					state={{ ...state, commitMessage: draft }}
					read={async () => "+selected"}
					onMessage={applied}
				/>
			</AiProvider>
		);

	render("Original");
	await settle();
	await press("ai-generate");
	await press("ai-commit-request");
	render("Edited by user");
	await settle();
	completion.resolve("Late suggestion");
	await settle();
	expect(signal?.aborted).toBe(true);
	expect(applied).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("ai-commit-proposal")).toBeUndefined();
});

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
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { cavemanCommitPreset } from "../../src/feature/ai/lib/caveman-commit-preset";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiConnection,
} from "../../src/feature/ai/lib/ai-settings-store";
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

const cliChoices = {
	"claude-code": [
		{
			value: "sonnet",
			label: "Sonnet",
			effort: {
				source: "cli" as const,
				levels: [
					{ value: "low", label: "Low" },
					{ value: "medium", label: "Medium" },
					{ value: "high", label: "High" },
					{ value: "max", label: "Max" },
				],
			},
		},
		{
			value: "opus",
			label: "Opus",
			effort: { source: "cli" as const, levels: [] },
		},
	],
	codex: [
		{
			value: "gpt-6-luna",
			label: "GPT-6 Luna",
			effort: {
				source: "cli" as const,
				levels: [
					{ value: "low", label: "Low" },
					{ value: "medium", label: "Medium" },
					{ value: "high", label: "High" },
					{ value: "xhigh", label: "Extra high" },
				],
			},
		},
		{
			value: "gpt-6.1-sol",
			label: "GPT-6.1 Sol",
			effort: {
				source: "cli" as const,
				levels: [{ value: "high", label: "High" }],
				default: "high",
			},
		},
	],
};

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
	spyOn(service, "models").mockImplementation(async (preferences) =>
		AiSettingsStore.isCli(preferences.provider)
			? cliChoices[preferences.provider]
			: choices
	);
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
function settings() {
	root.render(
		<AiProvider service={service}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					height: "100%",
					minHeight: 0,
					backgroundColor: "#ffffff",
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

it.each([
	{ protocol: "openai-chat", steps: 0 },
	{ protocol: "openai-responses", steps: 1 },
	{ protocol: "anthropic", steps: 2 },
] as const)(
	"configures $protocol with manual model/effort and vault-only auth headers",
	async ({ protocol, steps }) => {
		settings();
		await press("ai-add");
		await press("ai-provider-api");

		if (steps) {
			await press("ai-api-format");

			for (let step = 0; step < steps; step++) {
				root.renderer.simulateKeystrokes("down");
				await settle();
			}

			root.renderer.simulateKeystrokes("enter");
			await settle();
		}

		await type("ai-api-url", "https://gateway.example/custom/v1");
		await type("ai-api-header-name-0", "X-API-Key");
		await type("ai-api-header-value-0", "synthetic-secret");
		await press("ai-api-header-add");
		await type("ai-api-header-name-1", "X-Gateway-Key");
		await type("ai-api-header-value-1", "synthetic-extra");
		expect(node("ai-api-header-value-0").customProps?.type).toBe("password");
		await type("ai-api-model", "org/custom-model");
		await type("ai-api-effort", "high");
		await press("ai-use-default");

		if (process.env.GPUIX_AI_API_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_API_SCREENSHOT}-${protocol}.png`
			);

		await press("ai-save-preferences");
		const selected = AiSettingsStore.selected(service.store.load());

		expect(selected.api).toEqual({
			protocol,
			baseUrl: "https://gateway.example/custom/v1",
		});
		expect(selected.model).toBe("org/custom-model");
		expect(selected.effort).toBe("high");
		expect(JSON.stringify(service.store.load())).not.toContain("synthetic");
		const key = AiSettingsStore.credentialKey("api", "", selected.id);

		expect(JSON.parse(credentials.get(key) ?? "")).toEqual([
			{ name: "x-api-key", value: "synthetic-secret" },
			{ name: "x-gateway-key", value: "synthetic-extra" },
		]);
		await press(`ai-edit-${selected.id}`);
		expect(root.renderer.findByTestId("ai-api-header-value-0")).toBeUndefined();
		expect(root.renderer.getAllText()).toContain("Headers saved securely.");
		await type("ai-api-effort", "max");
		await press("ai-save-preferences");
		expect(credentials.get(key)).toContain("synthetic-secret");
		expect(AiSettingsStore.selected(service.store.load()).effort).toBe("max");
		await press(`ai-edit-${selected.id}`);
		await press("ai-api-replace-headers");
		await type("ai-api-header-value-0", "discarded-secret");
		await press("ai-cancel-editor");
		expect(credentials.get(key)).not.toContain("discarded-secret");
	}
);

it("groups ChatGPT connection methods with CLI selected by default and keyboard-accessible Login", async () => {
	settings();
	await press("ai-add");
	await press("ai-provider-chatgpt");
	expect(root.renderer.findByTestId("ai-provider-codex")).toBeUndefined();
	expect(node("ai-cli-test")).toBeDefined();
	expect(root.renderer.findByTestId("ai-chatgpt-connect")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Use CLI default");
	const cli = root.renderer.getElementBounds(node("ai-chatgpt-mode-cli").id)!;

	const login = root.renderer.getElementBounds(
		node("ai-chatgpt-mode-login").id
	)!;

	const provider = root.renderer.getElementBounds(
		node("ai-provider-chatgpt").id
	)!;

	expect(cli.y).toBe(login.y);
	expect(cli.y).toBeGreaterThan(provider.y + provider.height);
	expect(Math.abs(cli.width - login.width)).toBeLessThanOrEqual(1);
	await type("ai-account-name", "MyAssistant");
	await press("ai-cli-advanced");
	await type("ai-cli-executable", "/tmp/custom-codex");
	await press("ai-cli-advanced");
	root.renderer.focusElement(node("ai-chatgpt-mode-login").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(node("ai-chatgpt-connect")).toBeDefined();
	expect(root.renderer.findByTestId("ai-cli-test")).toBeUndefined();
	expect(node("ai-account-name").customProps?.value).toBe("MyAssistant");
	await press("ai-provider-chatgpt");
	expect(node("ai-chatgpt-connect")).toBeDefined();
	root.renderer.nativeSimulateKeyDown(node("ai-chatgpt-mode-cli").id, "space");
	root.renderer.nativeSimulateKeyUp(node("ai-chatgpt-mode-cli").id, "space");
	await settle();
	expect(node("ai-cli-test")).toBeDefined();
	await press("ai-cli-advanced");
	expect(node("ai-cli-executable").customProps?.value).toBe("");
	expect(service.store.load().connections).toHaveLength(0);
});

it.each(["chatgpt", "codex"] as const)(
	"reopens a saved %s connection in its existing mode without changing its identity",
	async (provider) => {
		const connection = {
			...configured,
			provider,
			model: provider === "codex" ? "" : configured.model,
		};

		service.store.save({ connections: [connection], defaultId: connection.id });
		settings();
		await press(`ai-edit-${connection.id}`);
		expect(root.renderer.findByTestId("ai-provider-codex")).toBeUndefined();
		expect(
			node(provider === "codex" ? "ai-cli-test" : "ai-chatgpt-connect")
		).toBeDefined();
		await press(
			provider === "codex" ? "ai-chatgpt-mode-login" : "ai-chatgpt-mode-cli"
		);
		expect(
			node(provider === "codex" ? "ai-cli-test" : "ai-chatgpt-connect")
		).toBeDefined();
		expect(service.store.load()).toEqual({
			connections: [connection],
			defaultId: connection.id,
		});
	}
);

it("ignores a late CLI catalog after switching ChatGPT to Login", async () => {
	const obsolete = Promise.withResolvers<typeof choices>();
	let signal: AbortSignal | undefined;

	spyOn(service, "hasCredentials").mockResolvedValue(true);
	spyOn(service, "models").mockImplementation(
		async (preferences, requestSignal) => {
			if (preferences.provider === "codex") {
				signal = requestSignal;

				return await obsolete.promise;
			}

			return choices;
		}
	);
	settings();
	await press("ai-add");
	await press("ai-provider-chatgpt");
	await press("ai-chatgpt-mode-login");
	expect(signal?.aborted).toBe(true);
	obsolete.resolve([{ value: "old-cli-model", label: "Old CLI model" }]);
	await settle();
	await press("ai-model");
	expect(root.renderer.getAllText()).toContain("Big Pickle");
	expect(root.renderer.getAllText()).not.toContain("Old CLI model");
});

it("keeps provider switching usable when cancelled CLI catalogs reject during effect cleanup", async () => {
	const requests: AbortSignal[] = [];

	spyOn(service, "models").mockImplementation(async (preferences, signal) => {
		if (!AiSettingsStore.isCli(preferences.provider)) return choices;

		requests.push(signal);

		return await new Promise<typeof choices>((_resolve, reject) => {
			signal.addEventListener(
				"abort",
				() => reject(new Error("Agent request cancelled.")),
				{ once: true }
			);
		});
	});
	settings();
	await press("ai-add");

	for (const provider of [
		"chatgpt",
		"claude-code",
		"api",
		"chatgpt",
		"claude-code",
		"opencode",
	])
		await press(`ai-provider-${provider}`);

	expect(requests.length).toBeGreaterThanOrEqual(4);
	expect(requests.every((signal) => signal.aborted)).toBe(true);
	expect(root.renderer.findByTestId("ai-models-error")).toBeUndefined();
	expect(root.renderer.getAllText()).not.toContain("Uncaught runtime errors:");
	await press("ai-model");
	expect(root.renderer.getAllText()).toContain("Big Pickle");
});

it.each(["claude-code", "codex"] as const)(
	"configures and tests %s with its CLI default and collapsed Advanced options",
	async (provider) => {
		spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
		spyOn(service.cli, "generate").mockResolvedValue("fix: update greeting");
		settings();
		await press("ai-add");

		await press(`ai-provider-${provider === "codex" ? "chatgpt" : provider}`);
		expect(node("ai-model")).toBeDefined();
		expect(root.renderer.findByTestId("ai-cli-model")).toBeUndefined();
		expect(root.renderer.findByTestId("ai-cli-executable")).toBeUndefined();
		expect(root.renderer.findByTestId("ai-chatgpt-connect")).toBeUndefined();
		expect(root.renderer.findByTestId("ai-api-key")).toBeUndefined();

		if (process.env.GPUIX_AI_CLI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_CLI_SCREENSHOT}-${provider}.png`
			);

		await press("ai-cli-test");
		expect(root.renderer.getAllText().join(" ")).toContain("Connection works.");
		expect(service.cli.generate).toHaveBeenCalledTimes(1);
		await press("ai-cli-advanced");
		expect(node("ai-cli-executable")).toBeDefined();
		await type("ai-cli-executable", "/tmp/custom-agent");
		await press("ai-cli-advanced");
		expect(root.renderer.findByTestId("ai-cli-executable")).toBeUndefined();
		await press("ai-use-default");
		await press("ai-save-preferences");
		const saved = AiSettingsStore.selected(service.store.load());

		expect(saved.provider).toBe(provider);
		expect(saved.model).toBe("");
		expect(saved.effort).toBe("");
		expect(saved.executable).toBe("/tmp/custom-agent");
		expect(root.renderer.findByTestId("ai-setup-panel")).toBeUndefined();
		expect(root.renderer.getAllText().join(" ")).toContain("CLI default");
	}
);

it.each(["claude-code", "codex"] as const)(
	"defaults %s effort to Medium and saves a keyboard-selected High",
	async (provider) => {
		spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
		settings();
		await press("ai-add");
		await press(`ai-provider-${provider === "codex" ? "chatgpt" : provider}`);
		expect(root.renderer.getAllText()).toContain("Provider default");
		await press("ai-model");
		root.renderer.simulateKeystrokes("down enter");
		await settle();
		expect(root.renderer.getAllText()).toContain("Medium");
		await press("ai-effort");

		if (process.env.GPUIX_AI_CLI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_CLI_SCREENSHOT}-${provider}-effort.png`
			);

		root.renderer.simulateKeystrokes("down enter");
		await settle();
		await press("ai-save-preferences");
		const connection = service.store.load().connections[0];

		expect(connection?.effort).toBe("high");
		await press(`ai-edit-${connection?.id}`);
		expect(root.renderer.getAllText()).toContain("High");
	}
);

it.each(["claude-code", "codex"] as const)(
	"selects and persists a %s model with keyboard navigation",
	async (provider) => {
		spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
		settings();
		await press("ai-add");
		await press(`ai-provider-${provider === "codex" ? "chatgpt" : provider}`);
		await press("ai-model");

		if (process.env.GPUIX_AI_CLI_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_AI_CLI_SCREENSHOT}-${provider}-models.png`
			);

		root.renderer.simulateKeystrokes("down enter");
		await settle();
		await press("ai-save-preferences");
		expect(service.store.load().connections[0]?.model).toBe(
			cliChoices[provider][0]?.value
		);
	}
);

it.each(["claude-code", "codex"] as const)(
	"updates %s effort when the model changes and inherits effort for the CLI default",
	async (provider) => {
		settings();
		await press("ai-add");
		await press(`ai-provider-${provider === "codex" ? "chatgpt" : provider}`);
		await press("ai-model");
		root.renderer.simulateKeystrokes("down enter");
		await settle();
		await press("ai-effort");
		const text = root.renderer.getAllText();

		expect(text).toContain(provider === "claude-code" ? "Max" : "Extra high");
		expect(text).not.toContain(
			provider === "claude-code" ? "Extra high" : "Max"
		);
		root.renderer.simulateKeystrokes("escape");
		await settle();
		await press("ai-model");
		root.renderer.simulateKeystrokes("down enter");
		await settle();

		if (provider === "claude-code")
			expect(root.renderer.findByTestId("ai-effort")).toBeUndefined();
		else {
			expect(root.renderer.getAllText()).toContain("High");
			expect(root.renderer.getAllText()).not.toContain("Medium");
		}

		await press("ai-model");
		root.renderer.simulateKeystrokes("up up enter");
		await settle();
		expect(root.renderer.getAllText()).toContain("Provider default");
	}
);

it("preserves a custom model in the dropdown and allows editing it in Advanced", async () => {
	const connection: AiConnection = {
		...configured,
		provider: "claude-code",
		model: "custom-model",
	};

	spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
	service.store.save({ connections: [connection], defaultId: connection.id });
	settings();
	await press(`ai-edit-${connection.id}`);
	expect(root.renderer.getAllText()).toContain("custom-model");
	expect(root.renderer.findByTestId("ai-cli-model")).toBeUndefined();
	await press("ai-cli-advanced");
	await type("ai-cli-model", "another-model");
	await press("ai-save-preferences");
	expect(service.store.load().connections[0]?.model).toBe("another-model");
});

it("keeps the CLI default and custom model usable when model discovery fails", async () => {
	spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
	spyOn(service, "models").mockRejectedValue(
		new Error("Could not load Codex models.")
	);
	settings();
	await press("ai-add");
	await press("ai-provider-chatgpt");
	expect(node("ai-models-error")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("Use CLI default");
	await press("ai-cli-advanced");
	await type("ai-cli-model", "custom-model");
	await press("ai-save-preferences");
	expect(service.store.load().connections[0]?.model).toBe("custom-model");
});

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

		expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
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

	expect(notice.y).toBeGreaterThanOrEqual(listScroll.y);
	expect(notice.y + notice.height).toBeLessThanOrEqual(
		listScroll.y + listScroll.height
	);
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
		await press("ai-chatgpt-mode-login");
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

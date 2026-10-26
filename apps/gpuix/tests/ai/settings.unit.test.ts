/**
 * Covers: opt-in defaults, v1 migration, private v2 metadata, credential separation and corrupt documents.
 * Real: AI settings store and disposable files.
 * Doubles: none.
 * Requires: writable temporary storage; no graphics, credentials or network.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AiSettingsStore,
	emptyAiPreferences,
	emptyAiConfiguration,
} from "../../src/feature/ai/lib/ai-settings-store";

let directory: string;
let store: AiSettingsStore;

const connection = {
	...emptyAiPreferences,
	id: "11111111-1111-4111-8111-111111111111",
	label: "Personal",
	provider: "opencode" as const,
	model: "big-pickle",
	instructions: "Use Conventional Commits.",
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-ai-settings-"));
	store = new AiSettingsStore(join(directory, "ai.json"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("starts off without creating files and saves independent account preferences privately", () => {
	expect(store.load()).toEqual(emptyAiConfiguration);
	expect(existsSync(store.path)).toBe(false);
	store.save({ connections: [connection], defaultId: connection.id });
	expect(AiSettingsStore.selected(store.load())).toMatchObject(connection);
	expect(statSync(store.path).mode & 0o777).toBe(0o600);
});

it("projects secrets out of nested metadata and separates credentials for accounts of the same provider", () => {
	const input = {
		...connection,
		accessToken: "never-save-me",
		apiKey: "not-settings",
	};

	store.save({
		connections: [input],
		defaultId: null,
	});
	const content = readFileSync(store.path, "utf8");

	expect(content).not.toContain("never-save-me");
	expect(content).not.toContain("not-settings");
	expect(AiSettingsStore.credentialKey("opencode", "", connection.id)).not.toBe(
		AiSettingsStore.credentialKey(
			"opencode",
			"",
			"22222222-2222-4222-8222-222222222222"
		)
	);
	expect(AiSettingsStore.credentialKey("opencode", "", "legacy-opencode")).toBe(
		AiSettingsStore.credentialKey("opencode")
	);
	expect(
		AiSettingsStore.credentialKey("chatgpt", "oaiapp_one", "legacy-chatgpt")
	).toBe(AiSettingsStore.credentialKey("chatgpt", "oaiapp_one"));
});

it.each([null, "opencode", "chatgpt"] as const)(
	"migrates existing %s selection and both identities without writing on load",
	(provider) => {
		const preferences = {
			...emptyAiPreferences,
			provider,
			model: "existing-model",
			instructions: "Existing instructions",
			hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
			chatgpt: {
				clientId: "oaiapp_one",
				subject: "one",
				email: "one@example.invalid",
			},
		};

		const original = JSON.stringify({ version: 1, preferences });

		writeFileSync(store.path, original);
		const migrated = store.load();

		expect(readFileSync(store.path, "utf8")).toBe(original);
		expect(migrated.defaultId).toBe(provider ? `legacy-${provider}` : null);
		expect(migrated.connections).toHaveLength(2);
		expect(
			migrated.connections.find((item) => item.provider === "chatgpt")?.chatgpt
		).toEqual(preferences.chatgpt);
		expect(AiSettingsStore.selected(migrated).provider).toBe(provider);

		if (provider)
			expect(AiSettingsStore.selected(migrated)).toMatchObject({
				model: "existing-model",
				instructions: "Existing instructions",
				hostId: preferences.hostId,
			});

		store.save(migrated);
		expect(JSON.parse(readFileSync(store.path, "utf8")).version).toBe(2);
		expect(store.load()).toEqual(migrated);
	}
);

it("rejects corrupt, duplicate or dangling selections without replacing the original file", () => {
	writeFileSync(store.path, "invalid-secret-content");
	expect(() => store.load()).toThrow("file was left unchanged");
	expect(readFileSync(store.path, "utf8")).toBe("invalid-secret-content");
	expect(() =>
		store.save({ connections: [connection, connection], defaultId: null })
	).toThrow("duplicate");
	expect(() =>
		store.save({ connections: [connection], defaultId: "missing" })
	).toThrow("selection");
	expect(() =>
		store.save({
			connections: [{ ...connection, model: "invalid\nmodel" }],
			defaultId: null,
		})
	).toThrow("Invalid AI preferences");
	expect(readFileSync(store.path, "utf8")).toBe("invalid-secret-content");
});

it.each(["claude-code", "codex"] as const)(
	"persists %s with its default model and optional executable without credentials",
	(provider) => {
		const cli = {
			...connection,
			provider,
			model: "",
			executable: "/opt/tools/agent with spaces",
		};

		store.save({ connections: [cli], defaultId: cli.id });
		expect(AiSettingsStore.selected(store.load())).toMatchObject(cli);
		expect(() =>
			AiSettingsStore.connection({ ...cli, executable: "agent --flag" })
		).toThrow("absolute path");
		expect(() =>
			AiSettingsStore.connection({ ...cli, executable: "/tmp/agent\ncommand" })
		).toThrow("absolute path");
	}
);

it.each(["claude-code", "codex"] as const)(
	"preserves unset %s effort until capabilities are known and persists native effort",
	(provider) => {
		const cli = { ...connection, provider, model: "" };

		const original = JSON.stringify({
			version: 2,
			connections: [cli],
			defaultId: cli.id,
		});

		writeFileSync(store.path, original);
		expect(AiSettingsStore.selected(store.load()).effort).toBeUndefined();
		expect(readFileSync(store.path, "utf8")).toBe(original);
		const high = AiSettingsStore.connection({ ...cli, effort: "xhigh" });

		store.save({ connections: [high], defaultId: cli.id });
		expect(AiSettingsStore.selected(store.load()).effort).toBe("xhigh");
		store.save({
			connections: [AiSettingsStore.connection({ ...cli, effort: "" })],
			defaultId: cli.id,
		});
		expect(AiSettingsStore.selected(store.load()).effort).toBe("");
		expect(() =>
			AiSettingsStore.connection({ ...cli, effort: 'high";bad' })
		).toThrow("effort");
	}
);

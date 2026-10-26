/**
 * Covers: isolated keys, per-account defaults/removal, credential rollback and concurrent ChatGPT refreshes.
 * Real: AI connection service, SDKs and disposable settings metadata.
 * Doubles: provider HTTP, browser authorization and OS credential vault.
 * Requires: Bun and temporary storage; no graphics, real sign-in or network.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { AiHttp, type AiFetch } from "../../src/feature/ai/lib/ai-http";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiConnection,
} from "../../src/feature/ai/lib/ai-settings-store";

let directory: string;
let credentials: Map<string, string>;
let service: AiIntegration;

const first: AiConnection = {
	...emptyAiPreferences,
	id: "11111111-1111-4111-8111-111111111111",
	label: "Personal",
	provider: "opencode",
	opencodeMode: "go",
	model: "minimax-m3",
	instructions: "Personal instructions",
};

const second: AiConnection = {
	...first,
	id: "22222222-2222-4222-8222-222222222222",
	label: "Work",
	instructions: "Work instructions",
};

const signal = () => new AbortController().signal;

function integration(fetch?: AiFetch) {
	return new AiIntegration(
		new AiSettingsStore(join(directory, "ai.json")),
		{
			read: async (key) => credentials.get(key) ?? null,
			write: async (key, value) => {
				credentials.set(key, value);
			},
			delete: async (key) => {
				credentials.delete(key);
			},
		},
		new AiHttp(
			fetch ??
				(async () => {
					throw new Error("Unexpected network request");
				})
		)
	);
}
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-ai-connections-"));
	credentials = new Map();
	service = integration();
});
afterEach(() => {
	mock.restore();
	rmSync(directory, { recursive: true, force: true });
});

it("stores independent OpenCode keys and instructions, and removes only the selected connection", async () => {
	await service.saveConnection(first, "personal-key", true, signal());
	await service.saveConnection(second, "work-key", false, signal());
	await service.saveConnection(
		{ ...first, label: "Renamed" },
		"",
		true,
		signal()
	);
	await service.connectKey(first, "reconnected-key", signal());
	expect(service.store.load().connections.map((item) => item.id)).toEqual([
		first.id,
		second.id,
	]);
	expect(service.store.load().connections[0]?.label).toBe("Renamed");
	expect(credentials.size).toBe(2);
	expect(AiSettingsStore.selected(service.store.load()).instructions).toBe(
		"Personal instructions"
	);
	service.setDefault(second.id);
	expect(AiSettingsStore.selected(service.store.load()).instructions).toBe(
		"Work instructions"
	);
	await service.disconnect(first, signal());
	expect(service.store.load().defaultId).toBe(second.id);
	expect(await service.hasCredentials(second)).toBe(true);
	expect(await service.hasCredentials(first)).toBe(false);
	await service.disconnect(second, signal());
	expect(service.store.load()).toEqual({ connections: [], defaultId: null });
	expect(credentials.size).toBe(0);
});

it("stores API headers only in the selected account's vault entry and preserves them on metadata edits", async () => {
	const api = {
		...first,
		provider: "api" as const,
		api: {
			protocol: "openai-chat" as const,
			baseUrl: "https://gateway.example/v1",
		},
		model: "org/custom-model",
		effort: "medium",
	};

	const headers = JSON.stringify([
		{ name: "Authorization", value: "Bearer synthetic-secret" },
		{ name: "X-Extra-Key", value: "synthetic-extra" },
	]);

	await service.saveConnection(api, headers, true, signal());
	await service.saveConnection(
		{ ...api, label: "Renamed" },
		"",
		true,
		signal()
	);
	await service.saveConnection(
		{ ...api, id: second.id, label: "Other API" },
		"[]",
		false,
		signal()
	);

	expect(readFileSync(service.store.path, "utf8")).not.toContain("synthetic");
	expect(
		credentials.get(AiSettingsStore.credentialKey("api", "", api.id))
	).toContain("synthetic-secret");
	expect(
		credentials.get(AiSettingsStore.credentialKey("api", "", second.id))
	).toBe("[]");
	expect(AiSettingsStore.selected(service.store.load()).effort).toBe("medium");
	await service.disconnect(api, signal());
	expect(
		credentials.has(AiSettingsStore.credentialKey("api", "", api.id))
	).toBe(false);
	expect(
		credentials.has(AiSettingsStore.credentialKey("api", "", second.id))
	).toBe(true);
});

it("keeps AI off when adding a Free profile until a default is explicitly selected", async () => {
	const free = { ...first, opencodeMode: "free" as const, model: "big-pickle" };

	await service.saveConnection(free, "", false, signal());
	expect(credentials.size).toBe(0);
	expect(AiSettingsStore.selected(service.store.load()).provider).toBeNull();
	service.setDefault(free.id);
	expect(AiSettingsStore.selected(service.store.load()).id).toBe(free.id);
});

it.each(["claude-code", "codex"] as const)(
	"saves, generates and removes %s without 1git credentials or a required model",
	async (provider) => {
		const connection = {
			...first,
			provider,
			model: "",
			executable: "/opt/tools/agent",
		};

		spyOn(service.cli, "check").mockResolvedValue("CLI 1.0");
		spyOn(service.cli, "generate").mockResolvedValue("fix: selected changes");
		const models = [{ value: "test-model", label: "Test model" }];

		spyOn(service.cli, "models").mockResolvedValue(models);
		await service.saveConnection(connection, "", false, signal());
		expect(service.store.load().defaultId).toBeNull();
		service.setDefault(connection.id);
		expect(AiSettingsStore.selected(service.store.load())).toMatchObject(
			connection
		);
		expect(await service.models(connection, signal())).toEqual(models);
		expect(await service.generate(connection, "+selected", signal())).toBe(
			"fix: selected changes"
		);
		expect(service.cli.generate).toHaveBeenCalledWith(
			AiSettingsStore.parse(connection),
			"+selected",
			expect.any(AbortSignal)
		);
		expect(await service.disconnect(connection, signal())).toContain(
			"remains signed in"
		);
		expect(service.store.load().defaultId).toBeNull();
		expect(credentials.size).toBe(0);
	}
);

it("restores an existing key if saving preferences fails, and never writes metadata after cancellation", async () => {
	await service.saveConnection(first, "old-key", true, signal());
	const saved = service.store.load();

	spyOn(service.store, "save").mockImplementation(() => {
		throw new Error("Disk unavailable");
	});
	await expect(
		service.saveConnection(first, "new-key", true, signal())
	).rejects.toThrow("Disk unavailable");
	expect(
		credentials.get(AiSettingsStore.credentialKey("opencode", "", first.id))
	).toBe("old-key");
	expect(service.store.load()).toEqual(saved);
	const controller = new AbortController();

	controller.abort();
	await expect(
		service.saveConnection(second, "work-key", false, controller.signal)
	).rejects.toThrow();
	expect(credentials.size).toBe(1);
});

it("saves ChatGPT identity without applying unsaved preferences or selecting it as default", async () => {
	const account = {
		clientId: "oaiapp_one",
		subject: "one",
		email: "one@example.invalid",
	};

	const connection = {
		...first,
		provider: "chatgpt" as const,
		model: "gpt-6.1-sol",
	};

	spyOn(service.authorization, "connect").mockResolvedValue({
		account,
		session: {
			...account,
			accessToken: "access",
			refreshToken: "refresh",
			idToken: "identity",
			scope: "resource.invoke chatgpt.tokens.use.direct",
			expiresAt: Date.now() + 3600000,
		},
	});
	const connected = await service.connect(
		connection,
		async () => undefined,
		signal()
	);

	expect(service.store.load().defaultId).toBeNull();
	expect(service.store.load().connections[0]).toMatchObject({
		id: connection.id,
		model: "",
		instructions: "",
		chatgpt: account,
	});
	await service.saveConnection(connected, "", true, signal());
	expect(AiSettingsStore.selected(service.store.load())).toMatchObject({
		id: connection.id,
		model: connection.model,
		instructions: connection.instructions,
	});
});

it("preserves other accounts and the default when ChatGPT sign-in is cancelled", async () => {
	await service.saveConnection(first, "personal-key", true, signal());
	const controller = new AbortController();
	const connection = { ...second, provider: "chatgpt" as const };

	spyOn(service.authorization, "connect").mockImplementation(async () => {
		controller.abort();
		controller.signal.throwIfAborted();

		throw new Error("Expected cancellation");
	});
	await expect(
		service.connect(connection, async () => undefined, controller.signal)
	).rejects.toThrow();
	expect(service.store.load().connections).toEqual([first]);
	expect(service.store.load().defaultId).toBe(first.id);
	expect(credentials.size).toBe(1);
	expect(service.store.load().hostId).toMatch(/^urn:uuid:/u);
});

it("rejects changing a saved connection's provider before opening authorization", async () => {
	await service.saveConnection(first, "personal-key", true, signal());
	const saved = service.store.load();
	const authorize = spyOn(service.authorization, "connect");

	await expect(
		service.connect(
			{ ...first, provider: "chatgpt" },
			async () => undefined,
			signal()
		)
	).rejects.toThrow("provider cannot change");
	expect(authorize).not.toHaveBeenCalled();
	expect(service.store.load()).toEqual(saved);
	expect(credentials.size).toBe(1);
});

it("refreshes different ChatGPT accounts independently while coalescing concurrent calls for the same account", async () => {
	const connections = [first, second].map((connection, index) => ({
		...connection,
		provider: "chatgpt" as const,
		chatgpt: {
			clientId: `oaiapp_${index}`,
			subject: `subject${index}`,
			email: `${index}@example.invalid`,
		},
	}));

	for (const connection of connections)
		credentials.set(
			AiSettingsStore.credentialKey(
				"chatgpt",
				connection.chatgpt.clientId,
				connection.id
			),
			JSON.stringify({
				...connection.chatgpt,
				accessToken: "expired",
				refreshToken: `refresh-${connection.id}`,
				idToken: "identity",
				scope: "resource.invoke chatgpt.tokens.use.direct",
				expiresAt: 0,
			})
		);

	const refreshes: string[] = [];
	const used = new Set<string>();

	service = integration(async (url, init) => {
		if (String(url).endsWith("oauth/token")) {
			const client = new URLSearchParams(String(init?.body)).get("client_id")!;

			refreshes.push(client);
			await Bun.sleep(10);

			return Response.json({
				access_token: `access-${client}`,
				refresh_token: `new-${client}`,
				token_type: "Bearer",
				expires_in: 3600,
			});
		}

		used.add(new Headers(init?.headers).get("authorization") ?? "");

		return Response.json({
			models: [
				{ slug: "gpt-6.1-sol", display_name: "GPT", visibility: "list" },
			],
		});
	});
	await Promise.all([
		service.models(connections[0]!, signal()),
		service.models(connections[0]!, signal()),
		service.models(connections[1]!, signal()),
	]);
	expect(refreshes.sort()).toEqual(["oaiapp_0", "oaiapp_1"]);
	expect([...used].sort()).toEqual([
		"Bearer access-oaiapp_0",
		"Bearer access-oaiapp_1",
	]);
	expect(
		credentials.get(
			AiSettingsStore.credentialKey("chatgpt", "oaiapp_0", first.id)
		)
	).toContain("new-oaiapp_0");
	expect(
		credentials.get(
			AiSettingsStore.credentialKey("chatgpt", "oaiapp_1", second.id)
		)
	).toContain("new-oaiapp_1");
});

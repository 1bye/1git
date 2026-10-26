/**
 * Covers: custom API formats, real HTTP streaming, custom headers, effort, anonymous endpoints and rejected redirects.
 * Real: AI service, Pi SDKs, Bun fetch and a local Postman simulation server.
 * Doubles: OS vault; contract-based provider responses in postman/mocks/ai-api.
 * Requires: running ai-api.sim.yaml and GPUIX_AI_API_TEST_URL pointing to its /ai-api/v1 base; no real credentials.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiConnection,
} from "../../src/feature/ai/lib/ai-settings-store";

let directory: string;
let service: AiIntegration;

beforeEach(async () => {
	if (!process.env.GPUIX_AI_API_TEST_URL)
		throw new Error(
			"Start postman/simulations/ai-api.sim.yaml and set GPUIX_AI_API_TEST_URL to its /ai-api/v1 base URL."
		);

	const url = new URL(process.env.GPUIX_AI_API_TEST_URL);

	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
	)
		throw new Error(
			"API integration tests require a loopback HTTP simulation URL."
		);

	directory = await mkdtemp(join(tmpdir(), "1git-api-http-"));
	const credentials = new Map<string, string>();

	service = new AiIntegration(new AiSettingsStore(join(directory, "ai.json")), {
		read: async (key) => credentials.get(key) ?? null,
		write: async (key, value) => {
			credentials.set(key, value);
		},
		delete: async (key) => {
			credentials.delete(key);
		},
	});
});
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

function connection(
	protocol: "openai-chat" | "openai-responses" | "anthropic"
): AiConnection {
	return {
		...emptyAiPreferences,
		id: "11111111-1111-4111-8111-111111111111",
		label: "Local API",
		provider: "api",
		api: { protocol, baseUrl: process.env.GPUIX_AI_API_TEST_URL ?? "" },
		model: "custom-model",
		effort: "medium",
	};
}

it.each(["openai-chat", "openai-responses", "anthropic"] as const)(
	"generates through %s over real HTTP with the selected headers and native effort",
	async (protocol) => {
		const preferences = connection(protocol);

		const headers = [
			{
				name: protocol === "anthropic" ? "x-api-key" : "Authorization",
				value:
					protocol === "anthropic"
						? "synthetic-api-secret"
						: "Bearer synthetic-api-secret",
			},
			{ name: "X-Gateway-Token", value: "synthetic-gateway-secret" },
		];

		const signal = AbortSignal.timeout(15_000);

		await service.saveConnection(
			preferences,
			JSON.stringify(headers),
			true,
			signal
		);
		const message = await service.generate(
			AiSettingsStore.selected(service.store.load()),
			"+handle empty greetings",
			signal
		);

		expect(message).toBe("fix: handle empty greetings");
	}
);

it.each(["openai-chat", "openai-responses", "anthropic"] as const)(
	"supports an explicitly unauthenticated %s endpoint",
	async (protocol) => {
		const preferences = {
			...connection(protocol),
			model: "anonymous",
			effort: "",
		};

		const signal = AbortSignal.timeout(15_000);

		await service.saveConnection(preferences, "[]", true, signal);
		expect(
			await service.generate(preferences, "+handle empty greetings", signal)
		).toBe("fix: handle empty greetings");
	}
);

it("sanitizes provider failures over real HTTP", async () => {
	const preferences = { ...connection("openai-chat"), model: "server-error" };
	const signal = AbortSignal.timeout(15_000);

	await service.saveConnection(preferences, "[]", true, signal);
	await expect(
		service.generate(preferences, "+selected", signal)
	).rejects.toThrow("HTTP 503");
});

it("does not forward configured auth headers across redirects", async () => {
	let forwarded = false;

	const trap = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => {
			forwarded = true;

			return new Response("unexpected");
		},
	});

	const preferences = { ...connection("openai-chat"), model: "redirect" };
	const signal = AbortSignal.timeout(15_000);

	try {
		await service.saveConnection(
			preferences,
			JSON.stringify([
				{ name: "Authorization", value: "Bearer synthetic-api-secret" },
				{ name: "x-test-redirect-to", value: trap.url.href },
			]),
			true,
			signal
		);
		await expect(
			service.generate(preferences, "+selected", signal)
		).rejects.toThrow();
		expect(forwarded).toBe(false);
	} finally {
		await trap.stop(true);
	}
});

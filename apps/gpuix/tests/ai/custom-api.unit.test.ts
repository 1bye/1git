/**
 * Covers: custom API URL/header validation, secret projection and exact native effort fields.
 * Real: configuration, settings and header parsing.
 * Doubles: none.
 * Requires: Bun; no network, graphics or real credentials.
 */
import { expect, it } from "bun:test";
import { CustomApi } from "../../src/feature/ai/lib/custom-api";
import {
	AiSettingsStore,
	emptyAiPreferences,
} from "../../src/feature/ai/lib/ai-settings-store";

it("normalizes custom API metadata without persisting auth headers or unknown properties", () => {
	const connection = AiSettingsStore.connection({
		...emptyAiPreferences,
		id: "11111111-1111-4111-8111-111111111111",
		label: "Gateway",
		provider: "api",
		api: {
			protocol: "anthropic",
			baseUrl: "https://gateway.example/custom/v1/",
			headers: { Authorization: "secret" },
		},
		model: "org/model",
		effort: "max",
		headers: "secret",
	});

	expect(connection.api).toEqual({
		protocol: "anthropic",
		baseUrl: "https://gateway.example/custom/v1",
	});
	expect(connection.model).toBe("org/model");
	expect(connection.effort).toBe("max");
	expect(JSON.stringify(connection)).not.toContain("secret");
	expect(
		CustomApi.configuration({
			protocol: "openai-chat",
			baseUrl: "http://127.0.0.1:1234/v1",
		}).baseUrl
	).toBe("http://127.0.0.1:1234/v1");
});

it.each([
	"file:///tmp/key",
	"ftp://example.com",
	"https://user:secret@example.com/v1",
	"https://example.com/v1?key=secret",
	"https://example.com/v1#secret",
	"https://example.com/\nprivate",
	"not-a-url",
])("rejects invalid API destinations (%#)", (baseUrl) => {
	expect(() =>
		CustomApi.configuration({ protocol: "openai-chat", baseUrl })
	).toThrow();
});

it("keeps multiple custom headers in the credential payload and accepts no auth", () => {
	const raw = CustomApi.credential(
		JSON.stringify([
			{ name: "Authorization", value: "Bearer synthetic-token" },
			{ name: "X-Account-Key", value: "synthetic-account" },
		])
	);

	const headers = CustomApi.headers(raw);

	expect(headers.get("authorization")).toBe("Bearer synthetic-token");
	expect(headers.get("x-account-key")).toBe("synthetic-account");
	expect(CustomApi.credential("[]")).toBe("[]");
});

it.each(
	[
		[{ name: "Host", value: "evil.example" }],
		[{ name: "Content-Length", value: "1" }],
		[{ name: "X-Key", value: "secret\r\nInjected: bad" }],
		[{ name: "bad header", value: "secret" }],
		[
			{ name: "X-Key", value: "a" },
			{ name: "x-key", value: "b" },
		],
		[{ name: "X-Key", value: "" }],
		[{ name: "X-Key", value: "   " }],
		Array.from({ length: 17 }, (_, index) => ({
			name: `X-Key-${index}`,
			value: "secret",
		})),
	].map((headers) => ({ headers }))
)(
	"rejects unsafe or ambiguous auth headers without echoing them (%#)",
	({ headers }) => {
		expect(() => CustomApi.headers(JSON.stringify(headers))).toThrow(
			"Enter valid, unique auth header names and values"
		);
	}
);

it("preserves explicit native effort values for each API format and omits unset effort", () => {
	const baseUrl = "https://gateway.example/v1";

	expect(
		CustomApi.payload({ protocol: "openai-chat", baseUrl }, "none", {
			model: "custom",
		})
	).toEqual({ model: "custom", reasoning_effort: "none" });
	expect(
		CustomApi.payload({ protocol: "openai-responses", baseUrl }, "xhigh", {
			model: "custom",
		})
	).toEqual({ model: "custom", reasoning: { effort: "xhigh" } });
	expect(
		CustomApi.payload({ protocol: "anthropic", baseUrl }, "max", {
			model: "custom",
		})
	).toEqual({ model: "custom", output_config: { effort: "max" } });
	expect(
		CustomApi.payload({ protocol: "anthropic", baseUrl }, "", {
			model: "custom",
		})
	).toEqual({ model: "custom" });
});

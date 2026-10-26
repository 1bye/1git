/**
 * Covers: OpenCode wire routing, free-only filtering, ChatGPT non-stored completed streams, limits and sanitized errors.
 * Real: Pi agent and provider adapters, AI service, preferences and disposable metadata files.
 * Doubles: provider HTTP and OS vault; synthetic credentials only.
 * Requires: Bun; no network, native graphics or real account.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiProvider } from "../../src/feature/ai/lib/pi-provider";
import { CommitHarness } from "../../src/feature/ai/lib/commit-harness";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { NativeCredentials } from "../../src/feature/accounts/lib/native-credentials";
import { AiHttp, type AiFetch } from "../../src/feature/ai/lib/ai-http";
import { cavemanCommitPreset } from "../../src/feature/ai/lib/caveman-commit-preset";
import {
	AiSettingsStore,
	emptyAiPreferences,
	type AiConnection,
} from "../../src/feature/ai/lib/ai-settings-store";

let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-ai-inference-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function integration(
	fetch: AiFetch,
	credentials = new Map<string, string>([
		[AiSettingsStore.credentialKey("opencode"), "synthetic-key"],
	])
) {
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
		new AiHttp(fetch)
	);
}

function events(values: unknown[]): Response {
	return new Response(
		values
			.map(
				(value) =>
					`${value && typeof value === "object" && "type" in value ? `event: ${value.type}\n` : ""}data: ${JSON.stringify(value)}\n\n`
			)
			.join(""),
		{ headers: { "Content-Type": "text/event-stream" } }
	);
}

const responseEvents = (completed = true) => [
	{
		type: "response.created",
		response: { id: "r1", created_at: 1, model: "gpt-test" },
	},
	{
		type: "response.output_item.added",
		output_index: 0,
		item: { id: "m1", type: "message", role: "assistant", content: [] },
	},
	{
		type: "response.content_part.added",
		item_id: "m1",
		output_index: 0,
		content_index: 0,
		part: { type: "output_text", text: "", annotations: [] },
	},
	{
		type: "response.output_text.delta",
		item_id: "m1",
		output_index: 0,
		content_index: 0,
		delta: "fix: selected changes",
	},
	{
		type: "response.output_text.done",
		item_id: "m1",
		output_index: 0,
		content_index: 0,
		text: "fix: selected changes",
	},
	{
		type: "response.output_item.done",
		output_index: 0,
		item: {
			id: "m1",
			type: "message",
			role: "assistant",
			content: [
				{ type: "output_text", text: "fix: selected changes", annotations: [] },
			],
		},
	},
	...(completed
		? [
				{
					type: "response.completed",
					response: {
						id: "r1",
						status: "completed",
						incomplete_details: null,
						usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
					},
				},
			]
		: []),
];

it.each([
	{ model: "gpt-5.2", effort: "xhigh", expected: "xhigh" },
	{ model: "gpt-5.2", effort: undefined, expected: "medium" },
	{ model: "gpt-5.2", effort: "", expected: undefined },
	{ model: "gpt-unknown", effort: "xhigh", expected: undefined },
])(
	"sends native API effort only for a known compatible model ($model, $effort)",
	async ({ model, effort, expected }) => {
		let body: Record<string, unknown> | undefined;

		const service = integration(async (_url, init) => {
			body = JSON.parse(String(init?.body));

			return events(responseEvents());
		});

		await service.generate(
			{
				...emptyAiPreferences,
				provider: "opencode",
				opencodeMode: "zen",
				model,
				effort,
			},
			"+checked",
			new AbortController().signal
		);

		expect(body?.reasoning).toEqual(
			expected ? { effort: expected, summary: "auto" } : undefined
		);
	}
);

it("enriches only models returned by the account and keeps unknown capabilities unknown", async () => {
	const service = integration(async () =>
		Response.json({ data: [{ id: "gpt-5.2" }, { id: "unknown-model" }] })
	);

	const models = await service.models(
		{ ...emptyAiPreferences, provider: "opencode", opencodeMode: "zen" },
		new AbortController().signal
	);

	expect(models.map((model) => model.value)).toEqual([
		"gpt-5.2",
		"unknown-model",
	]);
	expect(models[0]?.effort?.source).toBe("catalog");
	expect(models[0]?.effort?.levels.map((level) => level.value)).toEqual([
		"low",
		"medium",
		"high",
		"xhigh",
	]);
	expect(models[1]?.effort).toBeUndefined();
});

it("reuses one approved ChatGPT credential across model discovery and repeated generations", async () => {
	const account = {
		clientId: "oaiapp_test",
		subject: "one",
		email: "one@example.invalid",
	};

	const bytes = Buffer.from(
		JSON.stringify({
			...account,
			accessToken: "synthetic-access",
			refreshToken: "synthetic-refresh",
			idToken: "identity",
			scope: "resource.invoke chatgpt.tokens.use.direct",
			expiresAt: Date.now() + 3600000,
		})
	);

	const read = mock(async () => bytes);
	const vault = new NativeCredentials({ readHostingCredential: read });
	let requests = 0;

	const service = new AiIntegration(
		new AiSettingsStore(join(directory, "ai.json")),
		vault,
		new AiHttp(async (url, init) => {
			requests++;
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer synthetic-access"
			);

			return String(url).endsWith("/models")
				? Response.json({
						models: [
							{ slug: "gpt-6.1-sol", display_name: "Test", visibility: "list" },
						],
					})
				: events(responseEvents());
		})
	);

	const preferences = {
		...emptyAiPreferences,
		provider: "chatgpt" as const,
		model: "gpt-6.1-sol",
		chatgpt: account,
	};

	expect(
		await service.models(preferences, new AbortController().signal)
	).toHaveLength(1);

	for (let attempt = 0; attempt < 2; attempt++) {
		expect(
			await service.generate(
				preferences,
				"+checked",
				new AbortController().signal
			)
		).toBe("fix: selected changes");
	}

	expect(requests).toBe(3);
	expect(read).toHaveBeenCalledTimes(1);
	expect(bytes.every((byte) => byte === 0)).toBe(true);
});

it("uses OpenCode Free chat completions with explicit instructions and no automatic retries", async () => {
	let body: unknown;
	let address = "";
	let requests = 0;

	const service = integration(async (url, init) => {
		requests++;
		address = String(url);
		body = JSON.parse(String(init?.body));
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			"Bearer synthetic-key"
		);
		expect(new Headers(init?.headers).get("x-opencode-session")).toBeTruthy();

		return events([
			{
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: "big-pickle",
				choices: [
					{
						index: 0,
						delta: { content: "fix: checked changes" },
						finish_reason: null,
					},
				],
			},
			{
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: "big-pickle",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			},
		]);
	});

	const result = await service.generate(
		{
			...emptyAiPreferences,
			provider: "opencode",
			model: "big-pickle",
			instructions: "Keep it short.",
		},
		"+checked",
		new AbortController().signal
	);

	expect(result).toBe("fix: checked changes");
	expect(address).toBe("https://opencode.ai/zen/v1/chat/completions");
	expect(JSON.stringify(body)).toContain("Keep it short.");
	expect(JSON.stringify(body)).toContain("+checked");
	expect(requests).toBe(1);
});

it("sends the complete caveman-commit preset and removes presentation fences from a generated message", async () => {
	let body: unknown;

	const message =
		"fix(auth): isolate account credentials\n\nPrevent token reuse between saved connections.";

	const service = integration(async (_url, init) => {
		body = JSON.parse(String(init?.body));

		return events([
			{
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: "big-pickle",
				choices: [
					{
						index: 0,
						delta: { content: `\`\`\`text\n${message}\n\`\`\`` },
						finish_reason: null,
					},
				],
			},
			{
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: "big-pickle",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			},
		]);
	});

	const result = await service.generate(
		{
			...emptyAiPreferences,
			provider: "opencode",
			model: "big-pickle",
			instructions: cavemanCommitPreset,
		},
		"+selected",
		new AbortController().signal
	);

	expect(cavemanCommitPreset.length).toBeLessThanOrEqual(8000);
	expect(cavemanCommitPreset).toContain(
		"unless the user's own rule requires an `Assisted-by`/AI-attribution trailer"
	);
	expect(cavemanCommitPreset).toContain(
		"Always include body for: breaking changes, security fixes, data migrations, anything reverting a prior commit."
	);
	expect(body).toMatchObject({
		messages: expect.arrayContaining([
			expect.objectContaining({
				role: "system",
				content: expect.stringContaining(cavemanCommitPreset),
			}),
		]),
	});
	expect(result).toBe(message);
});

it("uses the OpenCode Go Messages protocol with bearer authentication", async () => {
	const service = integration(async (url, init) => {
		expect(String(url)).toBe("https://opencode.ai/zen/go/v1/messages");
		const headers = new Headers(init?.headers);

		expect(headers.get("Authorization")).toBe("Bearer synthetic-key");
		expect(headers.get("x-api-key")).toBeNull();
		expect(headers.get("x-opencode-session")).toBeTruthy();
		const body = JSON.parse(String(init?.body));

		expect(body.model).toBe("minimax-m3");
		expect(body.stream).toBe(true);
		expect(JSON.stringify(body.system)).toContain("Keep it short.");
		expect(JSON.stringify(body.messages)).toContain("+checked");

		return events([
			{
				type: "message_start",
				message: {
					id: "m1",
					type: "message",
					role: "assistant",
					model: "minimax-m3",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "fix: checked changes" },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: 4 },
			},
			{ type: "message_stop" },
		]);
	});

	expect(
		await service.generate(
			{
				...emptyAiPreferences,
				provider: "opencode",
				opencodeMode: "go",
				model: "minimax-m3",
				instructions: "Keep it short.",
			},
			"+checked",
			new AbortController().signal
		)
	).toBe("fix: checked changes");
});

it("continues OpenCode Go tool reads with the selected account and Messages wire format", async () => {
	const bodies: Record<string, unknown>[] = [];

	const service = integration(async (url, init) => {
		expect(String(url)).toBe("https://opencode.ai/zen/go/v1/messages");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer synthetic-key"
		);
		bodies.push(JSON.parse(String(init?.body)));
		const tool = bodies.length === 1;

		return events([
			{
				type: "message_start",
				message: {
					id: `m${bodies.length}`,
					type: "message",
					role: "assistant",
					model: "minimax-m3",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: tool
					? {
							type: "tool_use",
							id: "read1",
							name: "read_selected_diff",
							input: {},
						}
					: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: tool
					? {
							type: "input_json_delta",
							partial_json: JSON.stringify({ reads: [{ file: 0, page: 0 }] }),
						}
					: { type: "text_delta", text: "fix: selected changes" },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: {
					stop_reason: tool ? "tool_use" : "end_turn",
					stop_sequence: null,
				},
				usage: { output_tokens: 4 },
			},
			{ type: "message_stop" },
		]);
	});

	const message = await service.generate(
		{
			...emptyAiPreferences,
			provider: "opencode",
			opencodeMode: "go",
			model: "minimax-m3",
		},
		`diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+GO_SELECTED\ndiff --git a/b.ts b/b.ts\n@@ -0,0 +1 @@\n+${"x".repeat(260 * 1024)}\n`,
		new AbortController().signal
	);

	expect(message).toBe("fix: selected changes");
	expect(bodies).toHaveLength(2);
	expect(bodies[0]?.tools).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "read_selected_diff" }),
		])
	);
	expect(JSON.stringify(bodies[0])).not.toContain("GO_SELECTED");
	expect(bodies[1]?.messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				role: "user",
				content: expect.arrayContaining([
					expect.objectContaining({
						type: "tool_result",
						tool_use_id: "read1",
					}),
				]),
			}),
		])
	);
	expect(JSON.stringify(bodies[1])).toContain("GO_SELECTED");
});

it("loads the public Free catalog without reading saved credentials", async () => {
	const service = new AiIntegration(
		new AiSettingsStore(join(directory, "ai.json")),
		{
			read: async () => {
				throw new Error("Vault must not be read for public discovery");
			},
			write: async () => {
				throw new Error("Unexpected credential write");
			},
			delete: async () => {
				throw new Error("Unexpected credential removal");
			},
		},
		new AiHttp(async (url, init) => {
			expect(String(url)).toBe("https://opencode.ai/zen/v1/models");
			expect(new Headers(init?.headers).has("authorization")).toBe(false);

			return Response.json({
				data: [{ id: "big-pickle" }, { id: "gpt-paid" }],
			});
		})
	);

	expect(
		await service.models(
			{ ...emptyAiPreferences, provider: "opencode" },
			new AbortController().signal
		)
	).toEqual([{ value: "big-pickle", label: "big-pickle" }]);
});

it.each(["big-pickle", "muse-spark-1.3-contributor-free"])(
	"generates anonymously with %s without sending an auth header or using environment credentials",
	async (model) => {
		const previous = process.env.OPENAI_API_KEY;

		process.env.OPENAI_API_KEY = "synthetic-environment-key";
		let requests = 0;

		const service = integration(async (_url, init) => {
			requests++;
			const headers = new Headers(init?.headers);

			expect(headers.has("authorization")).toBe(false);
			expect(headers.has("x-api-key")).toBe(false);
			expect(headers.get("user-agent")).toStartWith("1git/0.0.1");

			return model === "big-pickle"
				? events([
						{
							id: "c1",
							object: "chat.completion.chunk",
							created: 1,
							model,
							choices: [
								{
									index: 0,
									delta: { content: "fix: selected changes" },
									finish_reason: "stop",
								},
							],
						},
					])
				: events(responseEvents());
		}, new Map());

		try {
			expect(
				await service.generate(
					{ ...emptyAiPreferences, provider: "opencode", model },
					"+synthetic",
					new AbortController().signal
				)
			).toBe("fix: selected changes");
			expect(requests).toBe(1);
		} finally {
			if (previous === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previous;
		}
	}
);

it.each(["go", "zen"] as const)(
	"still requires an API key for %s and never sends a request without one",
	async (opencodeMode) => {
		let requests = 0;

		const service = integration(async () => {
			requests++;

			return Response.json({ data: [] });
		}, new Map());

		const preferences = {
			...emptyAiPreferences,
			provider: "opencode" as const,
			opencodeMode,
			model: "gpt-6-sol",
		};

		await expect(
			service.models(preferences, new AbortController().signal)
		).rejects.toThrow("credentials");
		await expect(
			service.generate(preferences, "+synthetic", new AbortController().signal)
		).rejects.toThrow("credentials");
		expect(requests).toBe(0);
	}
);

it("does not load an Anthropic environment credential for anonymous Messages models", async () => {
	const previous = process.env.ANTHROPIC_API_KEY;

	process.env.ANTHROPIC_API_KEY = "synthetic-environment-key";
	let headers: Headers | undefined;

	const service = integration(async (_url, init) => {
		headers = new Headers(init?.headers);

		return new Response("private body", { status: 403 });
	}, new Map());

	try {
		await expect(
			service.generate(
				{
					...emptyAiPreferences,
					provider: "opencode",
					model: "claude-test-free",
				},
				"+synthetic",
				new AbortController().signal
			)
		).rejects.toThrow("anonymous");
		expect(headers?.has("authorization")).toBe(false);
		expect(headers?.has("x-api-key")).toBe(false);
	} finally {
		if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = previous;
	}
});

it("refuses paid models in Free and reports anonymous access failures without suggesting expired credentials", async () => {
	let requests = 0;

	const service = integration(async () => {
		requests++;

		return new Response("private body", { status: 403 });
	}, new Map());

	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "gpt-paid" },
			"+synthetic",
			new AbortController().signal
		)
	).rejects.toThrow("available AI model");
	expect(requests).toBe(0);
	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "big-pickle" },
			"+synthetic",
			new AbortController().signal
		)
	).rejects.toThrow("anonymous");
	expect(requests).toBe(1);
});

it("bounds streamed provider output without leaking its content", async () => {
	const service = integration(
		async () =>
			new Response("x".repeat(2 * 1024 * 1024 + 1), {
				headers: { "Content-Type": "text/event-stream" },
			})
	);

	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "big-pickle" },
			"+checked",
			new AbortController().signal
		)
	).rejects.toThrow("too much output");
});

it.each([true, false])(
	"requires a terminal ChatGPT response.completed event (completed: %s)",
	async (completed) => {
		let body: Record<string, unknown> = {};

		const inference = new CommitHarness(
			new PiProvider(
				new AiHttp(async (url, init) => {
					expect(String(url)).toBe("https://api.openai.com/v1/responses");
					body = JSON.parse(String(init?.body));

					return events(responseEvents(completed));
				})
			)
		);

		const request = inference.generate(
			{ ...emptyAiPreferences, provider: "chatgpt", model: "gpt-6.1-sol" },
			"synthetic-token",
			"+selected",
			new AbortController().signal
		);

		if (completed) expect(await request).toBe("fix: selected changes");
		else await expect(request).rejects.toThrow("interrupted");

		expect(body.store).toBe(false);
		expect(body.stream).toBe(true);
		expect(Array.isArray(body.input)).toBe(true);
		expect(typeof body.instructions).toBe("string");
		expect(body).not.toHaveProperty("temperature");
		expect(body).not.toHaveProperty("max_output_tokens");
		expect(body).not.toHaveProperty("metadata");
		expect(JSON.stringify(body.input)).not.toContain('"role":"system"');
	}
);

it.each(["gpt-6.1-sol", "gpt-6-luna"])(
	"finishes a non-stored %s review of 133 files after six tool turns",
	async (model) => {
		const bodies: Record<string, unknown>[] = [];

		const inference = new CommitHarness(
			new PiProvider(
				new AiHttp(async (_url, init) => {
					bodies.push(JSON.parse(String(init?.body)));

					if (bodies.length > 6) return events(responseEvents());

					const call = {
						id: `fc${bodies.length}`,
						type: "function_call",
						call_id: `read${bodies.length}`,
						name: "read_selected_diff",
						arguments: JSON.stringify({
							reads: [{ file: bodies.length === 6 ? 132 : 0, page: 0 }],
						}),
						status: "completed",
					};

					return events([
						{
							type: "response.created",
							response: { id: "r0", created_at: 1, model: "gpt-test" },
						},
						{
							type: "response.output_item.added",
							output_index: 0,
							item: { ...call, arguments: "", status: "in_progress" },
						},
						{
							type: "response.function_call_arguments.delta",
							item_id: call.id,
							output_index: 0,
							delta: call.arguments,
						},
						{
							type: "response.function_call_arguments.done",
							item_id: call.id,
							output_index: 0,
							arguments: call.arguments,
						},
						{ type: "response.output_item.done", output_index: 0, item: call },
						{
							type: "response.completed",
							response: {
								id: "r0",
								status: "completed",
								incomplete_details: null,
								output: [call],
								usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
							},
						},
					]);
				})
			)
		);

		const result = await inference.generate(
			{ ...emptyAiPreferences, provider: "chatgpt", model },
			"synthetic-token",
			`diff --git a/first.ts b/first.ts\n@@ -0,0 +1 @@\n+selected change\ndiff --git a/large.ts b/large.ts\n@@ -0,0 +1 @@\n+${"x".repeat(100 * 1024)}\n` +
				Array.from(
					{ length: 131 },
					(_, index) =>
						`diff --git a/feature-${index}.ts b/feature-${index}.ts\n@@ -0,0 +1 @@\n+selected ${index}\n`
				).join(""),
			new AbortController().signal
		);

		expect(result).toBe("fix: selected changes");
		expect(bodies).toHaveLength(7);
		expect(JSON.stringify(bodies[0]?.input)).toContain("feature-130.ts");

		for (const body of bodies) expect(body.store).toBe(false);

		expect(JSON.stringify(bodies[1]!.input)).toContain("function_call_output");
		expect(JSON.stringify(bodies[1]!.input)).toContain("+selected change");
		expect(JSON.stringify(bodies[6]?.input)).toContain("+selected 130");
		expect(bodies[6]).not.toHaveProperty("tools");
		expect(bodies[6]?.instructions).toContain("Write the commit message now");
	}
);

it("discovers only free text models, preserves order and handles distinct OpenCode protocols", async () => {
	const service = integration(async () =>
		Response.json({
			data: [
				{ id: "gpt-paid" },
				{ id: "jev-1.13-free" },
				{ id: "step-5-preview-free" },
				{ id: "big-pickle" },
				{ id: "big-pickle" },
			],
		})
	);

	const models = await service.models(
		{ ...emptyAiPreferences, provider: "opencode" },
		new AbortController().signal
	);

	expect(models.map((model) => model.value)).toEqual([
		"step-5-preview-free",
		"big-pickle",
	]);
	expect(PiProvider.protocol("gpt-6-luna", "go")).toBe("responses");
	expect(PiProvider.protocol("claude-haiku-5-5", "go")).toBe("messages");
	expect(PiProvider.protocol("minimax-m3", "go")).toBe("messages");
	expect(PiProvider.protocol("minimax-m3", "zen")).toBe("chat");
	expect(PiProvider.protocol("gemini-3.8-flash", "zen")).toBeNull();
	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "gpt-paid" },
			"+data",
			new AbortController().signal
		)
	).rejects.toThrow("available AI model");
});

it("never exposes provider error bodies or invalid JSON and refuses oversized prompts before sending", async () => {
	let requests = 0;

	const service = integration(async () => {
		requests++;

		return new Response("secret-provider-body", { status: 401 });
	});

	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "big-pickle" },
			"+data",
			new AbortController().signal
		)
	).rejects.toThrow("Reconnect in Settings");
	await expect(
		service.generate(
			{ ...emptyAiPreferences, provider: "opencode", model: "big-pickle" },
			"x".repeat(17 * 1024 * 1024),
			new AbortController().signal
		)
	).rejects.toThrow("collection limit");
	expect(requests).toBe(1);
	await expect(
		new AiHttp(async () => new Response("secret-invalid-json")).json(
			"https://opencode.ai/zen/v1/models",
			{},
			new AbortController().signal
		)
	).rejects.toThrow("invalid data");
});

it("serializes ChatGPT refresh, reuses rotated credentials and clears them on disconnect", async () => {
	const credentials = new Map([
		[
			AiSettingsStore.credentialKey("chatgpt", "oaiapp_test"),
			JSON.stringify({
				clientId: "oaiapp_test",
				subject: "one",
				accessToken: "expired",
				refreshToken: "old-refresh",
				idToken: "synthetic-id",
				scope: "resource.invoke chatgpt.tokens.use.direct",
				expiresAt: 0,
			}),
		],
	]);

	let refreshes = 0;

	const read = mock(async (key: string) => {
		const value = credentials.get(key);

		return value ? Buffer.from(value) : null;
	});

	const write = mock(async (key: string, bytes: Buffer) => {
		credentials.set(key, bytes.toString("utf8"));
	});

	const remove = mock(async (key: string) => {
		credentials.delete(key);
	});

	const vault = new NativeCredentials({
		readHostingCredential: read,
		writeHostingCredential: write,
		deleteHostingCredential: remove,
	});

	const http = new AiHttp(async (url, init) => {
		if (String(url).endsWith("/oauth/token")) {
			refreshes++;
			await Bun.sleep(10);

			return Response.json({
				access_token: "fresh",
				refresh_token: "rotated",
				token_type: "Bearer",
				expires_in: 3600,
			});
		}

		if (String(url).endsWith("/.well-known/openid-configuration"))
			return Response.json({
				revocation_endpoint: "https://auth.openai.com/oauth/revoke",
			});

		if (String(url).endsWith("/oauth/revoke")) {
			expect(new URLSearchParams(String(init?.body)).get("token")).toBe(
				"rotated"
			);

			return new Response(null, { status: 200 });
		}

		expect(new Headers(init?.headers).get("Authorization")).toBe(
			"Bearer fresh"
		);

		return Response.json({
			models: [
				{ slug: "hidden", display_name: "Hidden", visibility: "hide" },
				{
					slug: "gpt-6.1-sol",
					display_name: "GPT 6.1 Sol",
					visibility: "list",
				},
			],
		});
	});

	const store = new AiSettingsStore(join(directory, "ai.json"));
	const service = new AiIntegration(store, vault, http);

	const preferences: AiConnection = {
		...emptyAiPreferences,
		id: "legacy-chatgpt",
		label: "ChatGPT",
		provider: "chatgpt" as const,
		model: "gpt-6.1-sol",
		chatgpt: {
			clientId: "oaiapp_test",
			subject: "one",
			email: "one@example.invalid",
		},
	};

	store.save({ connections: [preferences], defaultId: preferences.id });

	const results = await Promise.all([
		service.models(preferences, new AbortController().signal),
		service.models(preferences, new AbortController().signal),
	]);

	expect(refreshes).toBe(1);
	expect(results[0]?.map(({ value, label }) => ({ value, label }))).toEqual([
		{ value: "gpt-6.1-sol", label: "GPT 6.1 Sol" },
	]);
	expect(results[0]?.[0]?.effort?.source).toBe("catalog");
	expect([...credentials.values()][0]).toContain("rotated");
	expect(
		await service.models(preferences, new AbortController().signal)
	).toEqual(results[0]!);
	expect(refreshes).toBe(1);
	expect(write).toHaveBeenCalledTimes(1);
	expect(
		await service.disconnect(preferences, new AbortController().signal)
	).toStartWith("Disconnected.");
	expect(remove).toHaveBeenCalledTimes(1);
	expect(credentials.size).toBe(0);
	expect(store.load()).toEqual({ connections: [], defaultId: null });
	expect(await service.hasCredentials(preferences)).toBe(false);
	await expect(
		service.generate(preferences, "+checked", new AbortController().signal)
	).rejects.toThrow("No AI credentials saved");
	expect(read).toHaveBeenCalledTimes(1);
});

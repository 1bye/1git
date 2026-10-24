/**
 * Covers: demand-driven selected reads, bounded agent work, failures and cancellation.
 * Real: Pi agent loop, provider serialization, commit harness and selection tools.
 * Doubles: captured provider HTTP and synthetic credentials.
 * Requires: Bun; no network or native graphics.
 */
import { expect, it } from "bun:test";
import { CommitHarness } from "../../src/feature/ai/lib/commit-harness";
import { PiProvider } from "../../src/feature/ai/lib/pi-provider";
import { AiHttp, type AiFetch } from "../../src/feature/ai/lib/ai-http";
import { emptyAiPreferences } from "../../src/feature/ai/lib/ai-settings-store";

const preferences = {
	...emptyAiPreferences,
	provider: "opencode" as const,
	model: "big-pickle",
	instructions: "Keep the subject short.",
};

function patch(name: string, contents: string): string {
	return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1 @@\n+${contents}\n`;
}

const large = patch("large.ts", "x".repeat(260 * 1024));

function chat(
	text: string,
	calls: { name: string; args: unknown }[] = []
): Response {
	return new Response(
		`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "big-pickle", choices: [{ index: 0, delta: { content: text, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: `read${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }] })}\n\n`,
		{ headers: { "Content-Type": "text/event-stream" } }
	);
}

function harness(fetch: AiFetch): CommitHarness {
	return new CommitHarness(new PiProvider(new AiHttp(fetch)));
}

it("keeps small selections to one request without tools", async () => {
	const bodies: Record<string, unknown>[] = [];

	const result = await harness(async (_url, init) => {
		bodies.push(JSON.parse(String(init?.body)));

		return chat("fix: small selection");
	}).generate(
		preferences,
		undefined,
		patch("a.ts", "small"),
		new AbortController().signal
	);

	expect(result).toBe("fix: small selection");
	expect(bodies).toHaveLength(1);
	expect(bodies[0]).not.toHaveProperty("tools");
});

it("isolates credentials, instructions and context between simultaneous generations", async () => {
	const requests: {
		authorization: string | null;
		body: string;
		session: string | null;
	}[] = [];

	const shared = harness(async (_url, init) => {
		const headers = new Headers(init?.headers);

		requests.push({
			authorization: headers.get("authorization"),
			body: String(init?.body),
			session: headers.get("x-opencode-session"),
		});

		return chat("fix: isolated selection");
	});

	await Promise.all(
		["first", "second"].map(
			async (account) =>
				await shared.generate(
					{ ...preferences, instructions: `${account} instructions` },
					`${account}-key`,
					patch(`${account}.ts`, `${account}-selected`),
					new AbortController().signal
				)
		)
	);

	expect(requests).toHaveLength(2);
	expect(new Set(requests.map((request) => request.session)).size).toBe(2);

	for (const account of ["first", "second"]) {
		const request = requests.find(
			(item) => item.authorization === `Bearer ${account}-key`
		);

		expect(request?.body).toContain(`${account} instructions`);
		expect(request?.body).toContain(`${account}-selected`);
		expect(request?.body).not.toContain(
			`${account === "first" ? "second" : "first"}-selected`
		);
	}
});

it("reads a large selection on demand in two model requests, with no preliminary summaries", async () => {
	const bodies: Record<string, unknown>[] = [];
	const progress: string[] = [];

	const result = await harness(async (_url, init) => {
		const body = JSON.parse(String(init?.body));

		bodies.push(body);

		return bodies.length === 1
			? chat("Let me inspect.", [
					{
						name: "read_selected_diff",
						args: {
							reads: [
								{ file: 0, page: 0 },
								{ file: 2, page: 0 },
							],
						},
					},
				])
			: chat("feat: cover selected behavior");
	}).generate(
		preferences,
		undefined,
		patch("first.ts", "FIRST_SELECTED") +
			large +
			patch("last.ts", "LAST_SELECTED"),
		new AbortController().signal,
		(status) => progress.push(status)
	);

	expect(result).toBe("feat: cover selected behavior");
	expect(bodies).toHaveLength(2);
	expect(JSON.stringify(bodies[0])).not.toContain("FIRST_SELECTED");
	expect(JSON.stringify(bodies[0])).toContain("last.ts");
	expect(JSON.stringify(bodies[1])).toContain("FIRST_SELECTED");
	expect(JSON.stringify(bodies[1])).toContain("LAST_SELECTED");
	expect(JSON.stringify(bodies[1])).not.toContain("x".repeat(100));
	expect(progress).toContain("Inspecting selected changes…");
	expect(bodies[0]?.tools).toMatchObject([
		{ function: { name: "changes_overview" } },
		{ function: { name: "read_selected_diff" } },
		{ function: { name: "search_selected_changes" } },
	]);
});

it("executes literal searches and paginated overviews without filesystem access", async () => {
	const bodies: { messages: { role: string; content: string }[] }[] = [];

	const source =
		large +
		Array.from({ length: 22 }, (_, index) =>
			patch(`file-${index}.ts`, `NEEDLE_${index}`)
		).join("");

	const result = await harness(async (_url, init) => {
		bodies.push(JSON.parse(String(init?.body)));

		return bodies.length === 1
			? chat("", [
					{ name: "changes_overview", args: { offset: 20 } },
					{
						name: "search_selected_changes",
						args: { query: "NEEDLE_21", offset: 0 },
					},
				])
			: chat("fix: selected behavior");
	}).generate(preferences, undefined, source, new AbortController().signal);

	expect(result).toBe("fix: selected behavior");
	expect(JSON.stringify(bodies[1])).toContain("NEEDLE_21");
	expect(JSON.stringify(bodies[1])).toContain("file-21.ts");
	expect(
		bodies[1]?.messages.filter((item) => item.role === "tool")
	).toHaveLength(2);
});

it("includes all 133 file overviews and reserves a final request after six review steps", async () => {
	const bodies: {
		messages: { role: string; content: string }[];
		tools?: unknown[];
	}[] = [];

	const source = Array.from({ length: 133 }, (_, index) =>
		patch(`feature-${index}.ts`, `SELECTED_${index}\n+${"x".repeat(600)}`)
	).join("");

	const result = await harness(async (_url, init) => {
		bodies.push(JSON.parse(String(init?.body)));

		return bodies.length <= 6
			? chat("", [
					{
						name: "read_selected_diff",
						args: {
							reads: [
								{
									file: bodies.length === 6 ? 132 : bodies.length - 1,
									page: 0,
								},
							],
						},
					},
				])
			: chat("feat: update selected features");
	}).generate(preferences, undefined, source, new AbortController().signal);

	expect(result).toBe("feat: update selected features");
	expect(bodies).toHaveLength(7);
	expect(JSON.stringify(bodies[0]?.messages)).toContain("feature-132.ts");
	expect(JSON.stringify(bodies[6]?.messages)).toContain("SELECTED_132");
	expect(bodies[6]?.tools ?? []).toHaveLength(0);
});

it("finishes from inspected evidence when a batch reaches the tool call limit", async () => {
	let requests = 0;
	let finalTools: unknown[] = [];

	const result = await harness(async (_url, init) => {
		requests++;
		finalTools = JSON.parse(String(init?.body)).tools ?? [];

		return requests === 1
			? chat(
					"",
					Array.from({ length: 25 }, () => ({
						name: "read_selected_diff",
						args: { reads: [{ file: 0, page: 0 }] },
					}))
				)
			: chat("fix: selected behavior");
	}).generate(
		preferences,
		undefined,
		patch("small.ts", "selected") + large,
		new AbortController().signal
	);

	expect(result).toBe("fix: selected behavior");
	expect(requests).toBe(2);
	expect(finalTools).toHaveLength(0);
});

it("rejects unknown IDs, path arguments, invalid schemas and unavailable tools without returning file content", async () => {
	const results: string[] = [];
	let requests = 0;

	await harness(async (_url, init) => {
		const body = JSON.parse(String(init?.body));

		requests++;

		if (requests > 1) {
			for (const message of body.messages)
				if (message.role === "tool") results.push(message.content);

			return chat("fix: selected behavior");
		}

		return chat("", [
			{ name: "read_selected_diff", args: { reads: [{ file: 0, page: 0 }] } },
			{ name: "read_selected_diff", args: { reads: [{ file: 99, page: 0 }] } },
			{
				name: "read_selected_diff",
				args: { reads: [{ file: "../../private", page: 0 }] },
			},
			{ name: "read_selected_diff", args: { reads: [] } },
			{ name: "bash", args: { command: "git commit" } },
		]);
	}).generate(
		preferences,
		undefined,
		patch("a.ts", "selected") + large,
		new AbortController().signal
	);

	expect(results).toHaveLength(5);
	expect(results[0]).toContain("+selected");
	expect(results[1]).toContain("outside the selected changes");
	expect(results.slice(1).join("\n")).not.toContain("+selected");
	expect(results[4]).toContain("not found");
});

it("rejects metadata-only answers and incomplete overview coverage", async () => {
	await expect(
		harness(async () => chat("feat: guessed from names")).generate(
			preferences,
			undefined,
			large,
			new AbortController().signal
		)
	).rejects.toThrow("did not inspect");
	let calls = 0;

	await expect(
		harness(async () =>
			++calls === 1
				? chat("", [
						{
							name: "read_selected_diff",
							args: { reads: [{ file: 0, page: 0 }] },
						},
					])
				: chat("feat: missed files")
		).generate(
			preferences,
			undefined,
			large +
				Array.from({ length: 999 }, (_, index) =>
					patch(`${index}.ts`, "selected")
				).join(""),
			new AbortController().signal
		)
	).rejects.toThrow("every file's overview");
});

it("bounds repeated reads across tool calls", async () => {
	let calls = 0;
	let results = "";
	let finalTools: unknown[] = [];

	await harness(async (_url, init) => {
		const body = JSON.parse(String(init?.body));

		calls++;

		if (calls > 1) {
			finalTools = body.tools ?? [];
			results = JSON.stringify(
				body.messages.filter((item: { role: string }) => item.role === "tool")
			);

			return chat("fix: selected behavior");
		}

		return chat(
			"",
			Array.from({ length: 12 }, () => ({
				name: "read_selected_diff",
				args: { reads: [{ file: 0, page: 0 }] },
			}))
		);
	}).generate(preferences, undefined, large, new AbortController().signal);

	expect(results).toContain("detail budget reached");
	expect(Buffer.byteLength(results)).toBeLessThan(110 * 1024);
	expect(finalTools).toHaveLength(0);
});

it("stops an agent that continues requesting tools", async () => {
	let requests = 0;

	await expect(
		harness(async () => {
			requests++;

			return chat("", [
				{ name: "read_selected_diff", args: { reads: [{ file: 0, page: 0 }] } },
			]);
		}).generate(preferences, undefined, large, new AbortController().signal)
	).rejects.toThrow("draft was left unchanged");
	expect(requests).toBe(7);
});

it("cancels active HTTP and never sends a continuation", async () => {
	const controller = new AbortController();
	let capturedSignal: AbortSignal | null | undefined;
	let requests = 0;

	await expect(
		harness(async (_url, init) => {
			requests++;
			capturedSignal = init?.signal;
			controller.abort();

			return chat("", [
				{ name: "read_selected_diff", args: { reads: [{ file: 0, page: 0 }] } },
			]);
		}).generate(preferences, undefined, large, controller.signal)
	).rejects.toThrow();
	expect(requests).toBe(1);
	expect(capturedSignal?.aborted).toBe(true);
});

it.each([400, 429, 500])(
	"does not retry or switch providers on HTTP %s",
	async (status) => {
		let requests = 0;

		await expect(
			harness(async (url) => {
				requests++;
				expect(String(url)).toBe("https://opencode.ai/zen/v1/chat/completions");

				return new Response("PRIVATE_ERROR_BODY", { status });
			}).generate(preferences, undefined, large, new AbortController().signal)
		).rejects.toThrow(
			status === 400 ? "rejected" : status === 429 ? "usage limit" : "HTTP 500"
		);
		expect(requests).toBe(1);
	}
);

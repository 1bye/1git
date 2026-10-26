const http = require("node:http");

// Contract-based streaming fixtures: https://developers.openai.com/api/reference
// and https://platform.claude.com/docs/en/api/streaming. No real provider traffic.
const text = "fix: handle empty greetings";

http
	.createServer((request, response) => {
		const body = request.body;
		const path = request.url?.split("?")[0];
		const claude = path === "/v1/messages";
		const responses = path === "/v1/responses";

		if (
			request.method !== "POST" ||
			(!claude && !responses && path !== "/v1/chat/completions")
		) {
			response.writeHead(501).end();

			return;
		}

		if (body?.model === "redirect") {
			response
				.writeHead(302, { location: request.headers["x-test-redirect-to"] })
				.end();

			return;
		}

		if (body?.model === "server-error") {
			response
				.writeHead(503, { "Content-Type": "text/html" })
				.end("private-provider-error");

			return;
		}

		const anonymous = body?.model === "anonymous";

		const auth = anonymous
			? !request.headers.authorization && !request.headers["x-api-key"]
			: claude
				? request.headers["x-api-key"] === "synthetic-api-secret" &&
					!request.headers.authorization
				: request.headers.authorization === "Bearer synthetic-api-secret" &&
					!request.headers["x-api-key"];

		const effort = claude
			? body?.output_config?.effort
			: responses
				? body?.reasoning?.effort
				: body?.reasoning_effort;

		const content = claude || !responses ? body?.messages : body?.input;

		if (
			!auth ||
			!Array.isArray(content) ||
			!body?.stream ||
			(responses &&
				(body.store !== false ||
					!body.include?.includes("reasoning.encrypted_content"))) ||
			(!anonymous &&
				(request.headers["x-gateway-token"] !== "synthetic-gateway-secret" ||
					effort !== "medium"))
		) {
			response
				.writeHead(400, { "Content-Type": "application/json" })
				.end(JSON.stringify({ error: "Invalid request contract" }));

			return;
		}

		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const emit = (value) =>
			response.write(
				`${value.type ? `event: ${value.type}\n` : ""}data: ${JSON.stringify(value)}\n\n`
			);

		if (claude) {
			emit({
				type: "message_start",
				message: {
					id: "m1",
					type: "message",
					role: "assistant",
					model: body.model,
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			});
			emit({
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			});
			emit({
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text },
			});
			emit({ type: "content_block_stop", index: 0 });
			emit({
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: 5 },
			});
			emit({ type: "message_stop" });
		} else if (responses) {
			emit({
				type: "response.created",
				response: { id: "r1", model: body.model, created_at: 1 },
			});
			emit({
				type: "response.output_item.added",
				output_index: 0,
				item: { id: "m1", type: "message", role: "assistant", content: [] },
			});
			emit({
				type: "response.content_part.added",
				item_id: "m1",
				output_index: 0,
				content_index: 0,
				part: { type: "output_text", text: "", annotations: [] },
			});
			emit({
				type: "response.output_text.delta",
				item_id: "m1",
				output_index: 0,
				content_index: 0,
				delta: text,
			});
			emit({
				type: "response.output_item.done",
				output_index: 0,
				item: {
					id: "m1",
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text, annotations: [] }],
				},
			});
			emit({
				type: "response.completed",
				response: {
					id: "r1",
					status: "completed",
					incomplete_details: null,
					usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
				},
			});
		} else {
			emit({
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: body.model,
				choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
			});
			emit({
				id: "c1",
				object: "chat.completion.chunk",
				created: 1,
				model: body.model,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			});
			response.write("data: [DONE]\n\n");
		}

		response.end();
	})
	.listen(process.env.PORT || 4915);

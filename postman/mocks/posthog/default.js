const http = require("node:http");

// Contract: https://posthog.com/docs/api/capture. Other endpoints are deliberately unmodeled.
http
	.createServer((request, response) => {
		if (
			request.method !== "POST" ||
			(request.url !== "/i/v0/e/" && request.url !== "/i/v0/e")
		) {
			response.writeHead(501);
			response.end();

			return;
		}

		const body = request.body;

		const valid =
			body &&
			typeof body.api_key === "string" &&
			typeof body.event === "string" &&
			typeof body.distinct_id === "string" &&
			body.properties?.$process_person_profile === false;

		response.writeHead(valid ? 200 : 400, {
			"Content-Type": "application/json",
		});
		response.end(
			JSON.stringify(
				valid ? { status: 1 } : { error: "Invalid anonymous capture envelope" }
			)
		);
	})
	.listen(process.env.PORT || 4910);

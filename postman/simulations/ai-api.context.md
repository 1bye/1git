# AI API simulation

Created 2026-10-26 from the official [OpenAI API reference](https://developers.openai.com/api/reference)
and [Claude streaming contract](https://platform.claude.com/docs/en/api/streaming).
The owner-mock search was skipped because the Postman CLI is signed out.

## Purpose

The AI API stand-in checks custom Chat Completions, Responses, and Messages
requests over real HTTP, including header routing and native effort fields.
Unmodeled routes return 501. All credentials and selected changes are synthetic.

## Execution

Run `postman simulation run postman/simulations/ai-api.sim.yaml --port auto --no-history --output ndjson`.
Take PORT from the `listening` event. In another terminal run
`GPUIX_AI_API_TEST_URL=http://localhost:PORT/ai-api/v1 bun run --cwd apps/gpuix test:ai:api`.
Check the request log, then stop the simulation with Ctrl+C. Do not commit logs.

## Assumptions

- The tests require a loopback HTTP URL. They do not establish compatibility
  with a real gateway, model access, billing, or account authentication.
- The fixtures validate the request fields used here and return documented SSE
  event shapes. They do not model inference or large-selection tool calls.
- Local binding and fetch required leaving the command sandbox on this Mac.

## Observations

<!-- begin:observations -->
2026-10-26: broad app verification repeated all eight HTTP checks successfully.
The member served all six normal requests plus the expected 503 and 302; the
redirect trap received no requests. No live custom endpoint was contacted.
2026-10-26: the final run also passed all eight checks, with the Responses
fixture requiring `store: false` and `reasoning.encrypted_content`. All calls
reached the member, including the expected 503 and 302; the redirect trap stayed silent.
2026-10-26: CLI 1.75.0 served eight POST requests: six successful authenticated
or anonymous generations, one 503, and one 302. The redirect trap received no
traffic. All eight integration tests passed; the sole member served all calls.
<!-- end:observations -->

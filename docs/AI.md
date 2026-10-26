# AI commit messages

1git drafts commit messages from the checked files and selected lines. Configure
providers in **Settings → AI**.

## ChatGPT

ChatGPT offers **CLI** (the default, using Codex) and **Login** connection tiles.
Existing connections retain their selected method.

## Custom API endpoints

Choose **API** in **Settings → AI**. Select OpenAI Chat Completions, OpenAI
Responses, or Claude Messages, then enter the base URL (including any `/v1`
path), model ID, and optional native effort value. The app appends the selected
format's endpoint. Add auth headers such as `Authorization` with a `Bearer …`
value or `x-api-key`; their values are masked and saved only in the OS
credential store. Remove all headers for an unauthenticated endpoint. Leaving
effort blank uses the provider's default. Models and effort are manual for
custom endpoints, so a model-list API is not required.

## Claude Code and Codex CLI

Install and sign in to Claude Code (`claude auth login`) or Codex
(`codex login`), then add it in **Settings → AI**. Choose a model from the
dropdown, or select **Use CLI default**. Both agents report their available
models and per-model effort options. **Effort** initially selects Medium when
supported, otherwise the model's reported default. **Provider default** inherits
the agent's settings, as does **Use CLI default**. Unknown capabilities never
produce guessed effort options. Direct API accounts use their live model list
with capability metadata from the bundled Pi catalog where available.

**Advanced** contains custom model entry and an optional executable path for
installations outside the usual search paths. **Test agent** sends a synthetic
diff to verify the connection using your CLI account.

1git reuses the CLI's authentication without copying its credentials.
Generation uses the checked files and selected lines, with tools and hooks
restricted, and only updates the commit draft. CLI requests currently support up
to 64 KiB of selected changes; larger selections can use an API connection.

## Tests

- `bun run --cwd apps/gpuix test:ai:process` runs subprocess regression tests.
- `bun run --cwd apps/gpuix test:ai:cli` tests both installed agents against
  their real providers using their signed-in accounts. Optional
  `GPUIX_CLAUDE_PATH`, `GPUIX_CODEX_PATH`, and `GPUIX_CODEX_MODEL` variables
  select test executables or a Codex model without changing the CLI
  configuration.
- Custom API HTTP tests use the local
  [API simulation](../postman/simulations/ai-api.context.md):
  `GPUIX_AI_API_TEST_URL=http://localhost:PORT/ai-api/v1 bun run --cwd apps/gpuix test:ai:api`.

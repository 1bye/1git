/**
 * Covers: installed Claude Code and Codex generating commit drafts with their existing logins and default models.
 * Real: both CLI processes, provider inference, AI integration and disposable settings.
 * Doubles: vault and direct HTTP throw if accessed; supplied diff is synthetic.
 * Requires: explicit `bun run test:ai:cli`, installed/authenticated CLIs, network and account usage.
 */
import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiIntegration } from "../../src/feature/ai/lib/ai-integration";
import { AiHttp } from "../../src/feature/ai/lib/ai-http";
import {
	AiSettingsStore,
	emptyAiPreferences,
} from "../../src/feature/ai/lib/ai-settings-store";

it.each(["claude-code", "codex"] as const)(
	"generates a draft through the installed %s and its own login",
	async (provider) => {
		if (process.env.GPUIX_AI_CLI_SMOKE !== "1")
			throw new Error(
				"Run this live suite explicitly with bun run test:ai:cli."
			);

		const directory = await mkdtemp(join(tmpdir(), "1git-ai-live-"));

		const unexpected = async (): Promise<never> => {
			throw new Error(
				"CLI generation must not access 1git credentials or HTTP."
			);
		};

		const service = new AiIntegration(
			new AiSettingsStore(join(directory, "ai.json")),
			{ read: unexpected, write: unexpected, delete: unexpected },
			new AiHttp(unexpected)
		);

		const connection = {
			...emptyAiPreferences,
			provider,
			id: "11111111-1111-4111-8111-111111111111",
			label: provider,
			executable:
				provider === "claude-code"
					? process.env.GPUIX_CLAUDE_PATH
					: process.env.GPUIX_CODEX_PATH,
			instructions: "Use Conventional Commits. Write in English.",
			model:
				provider === "codex" ? (process.env.GPUIX_CODEX_MODEL ?? "") : "sonnet",
			effort: "medium",
		};

		const signal = AbortSignal.timeout(180_000);

		try {
			await service.saveConnection(connection, "", true, signal);
			const selected = AiSettingsStore.selected(service.store.load());
			const models = await service.models(selected, signal);

			expect(models.length).toBeGreaterThan(0);
			expect(models.every((model) => model.value && model.label)).toBe(true);
			expect(
				models.some(
					(model) =>
						model.effort?.source === "cli" &&
						model.effort.levels.some((level) => level.value === "medium")
				)
			).toBe(true);

			const message = await service.generate(
				selected,
				"diff --git a/greeting.ts b/greeting.ts\n--- a/greeting.ts\n+++ b/greeting.ts\n@@ -1 +1 @@\n-export const greeting = 'Hello';\n+export const greeting = 'Hello world';\n",
				signal
			);

			expect(selected.model).toBe(connection.model);
			expect(selected.effort).toBe("medium");
			expect(message).toMatch(
				/^(?:feat|fix|chore|refactor|docs|style|test|build|ci|perf)(?:\([^\n]+\))?!?: /u
			);
			expect(message).toMatch(/greet|hello|world/iu);
			expect(message).not.toContain("```");
			expect(message.length).toBeLessThanOrEqual(8000);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	190_000
);

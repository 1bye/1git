/**
 * Covers: per-model effort selection, unknown capabilities and provider catalog fallback.
 * Real: selection helpers and the installed Pi model catalog.
 * Doubles: none.
 * Requires: Bun; no network or native graphics.
 */
import { expect, it } from "bun:test";
import {
	findModel,
	modelEffort,
	type AiModel,
} from "../../src/feature/ai/lib/ai-model";
import { PiProvider } from "../../src/feature/ai/lib/pi-provider";
import { emptyAiPreferences } from "../../src/feature/ai/lib/ai-settings-store";

it("prefers Medium only when available and preserves native values and an explicit provider default", () => {
	const model: AiModel = {
		value: "alias",
		resolvedModel: "resolved",
		label: "Model",
		effort: {
			source: "cli",
			levels: [
				{ value: "medium", label: "Medium" },
				{ value: "max", label: "Max" },
			],
			default: "max",
		},
	};

	expect(modelEffort(model)).toBe("medium");
	expect(modelEffort(model, "max")).toBe("max");
	expect(modelEffort(model, "")).toBe("");
	expect(
		modelEffort({
			...model,
			effort: {
				source: "cli",
				levels: [{ value: "max", label: "Max" }],
				default: "max",
			},
		})
	).toBe("max");
	expect(
		modelEffort({
			...model,
			effort: { source: "cli", levels: [{ value: "max", label: "Max" }] },
		})
	).toBe("");
	expect(findModel([model], "resolved")).toBe(model);
	expect(findModel([model], "")).toBeUndefined();
});

it("inherits defaults for unknown and unsupported capabilities, including stale selections", () => {
	expect(modelEffort(undefined, "high")).toBe("");
	expect(modelEffort({ value: "custom", label: "Custom" }, "medium")).toBe("");
	expect(
		modelEffort(
			{ value: "old", label: "Old", effort: { source: "cli", levels: [] } },
			"max"
		)
	).toBe("");
});

it("uses the API provider's catalog and distinguishes adaptive effort from thinking budgets", async () => {
	const openai = await PiProvider.catalog({
		...emptyAiPreferences,
		provider: "chatgpt",
	});

	const opencode = await PiProvider.catalog({
		...emptyAiPreferences,
		provider: "opencode",
		opencodeMode: "zen",
	});

	const levels = (models: typeof openai, id: string) =>
		PiProvider.capabilities(
			models.find((model) => model.id === id)
		).effort?.levels.map((level) => level.value);

	expect(levels(openai, "gpt-5-pro")).toEqual(["high"]);
	expect(levels(openai, "gpt-5.2")).toEqual(["low", "medium", "high", "xhigh"]);
	expect(levels(opencode, "claude-opus-4-7")).toEqual([
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	expect(levels(opencode, "claude-haiku-4-5")).toBeUndefined();
	expect(levels(opencode, "unknown-model")).toBeUndefined();
});

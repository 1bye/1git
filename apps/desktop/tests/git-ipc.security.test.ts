import { describe, expect, test } from "bun:test";
import type { GitResult, RepositorySnapshot } from "@1git/git";
import { GIT_IPC_CHANNELS } from "../src/shared/git-ipc.js";
import { GitIpcHarness } from "./_shared/git-ipc-harness.js";
import { createTestRepositoryManager } from "./_shared/repository-manager-fixture.js";

describe("Git IPC security and validation", () => {
	test("rejects an unauthorized sender", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		const invocation = harness.invokeUnauthorized(
			GIT_IPC_CHANNELS.sessions.state
		);

		await expect(invocation).rejects.toThrow("Unauthorized Git IPC sender.");
		harness.dispose();
	});

	test("returns GitResult invalid-input for a malformed operation envelope", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		const result = await harness.invoke<GitResult<RepositorySnapshot>>(
			GIT_IPC_CHANNELS.repository.snapshot,
			{ input: {} }
		);

		expect(result).toEqual({
			error: {
				code: "invalid-input",
				message: "sessionId must be a non-empty string.",
				operation: "get-snapshot",
				retryable: false,
			},
			ok: false,
		});
		harness.dispose();
	});

	test("returns GitResult not-found for an unknown repository session", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		const result = await harness.invoke<GitResult<RepositorySnapshot>>(
			GIT_IPC_CHANNELS.repository.snapshot,
			{ input: {}, sessionId: "missing" }
		);

		expect(result).toEqual({
			error: {
				code: "not-found",
				message: 'Repository session "missing" was not found.',
				operation: "get-snapshot",
				retryable: false,
			},
			ok: false,
		});
		harness.dispose();
	});

	test("returns GitResult invalid-input for an invalid open payload", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		const result = await harness.invoke(GIT_IPC_CHANNELS.sessions.open, {
			path: "",
		});

		expect(result).toMatchObject({
			error: {
				code: "invalid-input",
				operation: "open-repository",
			},
			ok: false,
		});
		harness.dispose();
	});
});

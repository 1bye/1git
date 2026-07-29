import { afterEach, describe, expect, test } from "bun:test";
import type { GitResult, RepositorySnapshot } from "@1git/git";
import { GIT_IPC_CHANNELS } from "../src/shared/git-ipc.js";
import type { OpenedRepositorySession } from "../src/shared/repository-session.js";
import { GitIpcHarness } from "./_shared/git-ipc-harness.js";
import {
	createTestRepositoryManager,
	RepositoryFixtures,
} from "./_shared/repository-manager-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

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

	test("cancels an active operation through its sender-scoped ID", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());
		const pending = harness.runTrackedOperation(
			"fetch-from-renderer",
			"fetch",
			async (signal) =>
				await new Promise<GitResult<never>>((resolve) => {
					signal.addEventListener(
						"abort",
						() =>
							resolve({
								error: {
									code: "aborted",
									message: "Git operation was aborted.",
									operation: "fetch",
									retryable: false,
								},
								ok: false,
							}),
						{ once: true }
					);
				})
		);

		const cancellation = await harness.invoke(
			GIT_IPC_CHANNELS.operations.cancel,
			{ operationId: "fetch-from-renderer" }
		);

		expect(cancellation).toEqual({
			operationId: "fetch-from-renderer",
			status: "cancelled",
		});
		expect(await pending).toMatchObject({
			error: { code: "aborted" },
			ok: false,
		});
		expect(harness.operationRegistry.activeCount).toBe(0);
		harness.dispose();
	});

	test("returns not-found when an operation already completed", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		const cancellation = await harness.invoke(
			GIT_IPC_CHANNELS.operations.cancel,
			{ operationId: "completed-operation" }
		);

		expect(cancellation).toEqual({
			operationId: "completed-operation",
			status: "not-found",
		});
		harness.dispose();
	});

	test("cancels a live Git child process through the preload protocol", async () => {
		const fixture = await fixtures.create();
		const executable = await fixtures.createBlockingGitExecutable();
		const harness = new GitIpcHarness(
			createTestRepositoryManager({
				runtime: { executable },
			})
		);
		const opening = harness.invoke<GitResult<OpenedRepositorySession>>(
			GIT_IPC_CHANNELS.sessions.open,
			{
				operationId: "blocked-open",
				path: fixture.repositoryPath,
			}
		);

		expect(harness.operationRegistry.activeCount).toBe(1);
		const cancellation = await harness.invoke(
			GIT_IPC_CHANNELS.operations.cancel,
			{ operationId: "blocked-open" }
		);
		const result = await opening;

		expect(cancellation).toEqual({
			operationId: "blocked-open",
			status: "cancelled",
		});
		expect(result).toMatchObject({
			error: {
				code: "aborted",
				operation: "open-repository",
			},
			ok: false,
		});
		expect(harness.operationRegistry.activeCount).toBe(0);
		expect(harness.repositoryManager.getState().sessions).toEqual([]);
		harness.dispose();
	});
});

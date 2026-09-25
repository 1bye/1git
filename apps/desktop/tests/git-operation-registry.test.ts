import { describe, expect, test } from "bun:test";

import type { GitOperation, GitResult } from "@1git/git";

import {
	GitOperationRegistry,
	isValidGitOperationId,
} from "../src/main/git/git-operation-registry.js";

const abortedResult = (operation: GitOperation): GitResult<never> => ({
	error: {
		code: "aborted",
		message: "Git operation was aborted.",
		operation,
		retryable: false,
	},
	ok: false,
});

const waitForAbort =
	(operation: GitOperation) =>
	async (signal: AbortSignal): Promise<GitResult<never>> =>
		await new Promise<GitResult<never>>((resolve) => {
			if (signal.aborted) {
				resolve(abortedResult(operation));
				return;
			}
			signal.addEventListener(
				"abort",
				() => resolve(abortedResult(operation)),
				{ once: true }
			);
		});

describe("GitOperationRegistry", () => {
	test("tracks an operation until it completes", async () => {
		const registry = new GitOperationRegistry();
		const owner = {};

		const result = await registry.run({
			operation: "get-snapshot",
			operationId: "snapshot-1",
			owner,
			task: () =>
				Promise.resolve({
					ok: true,
					value: "complete",
				}),
		});

		expect(result).toEqual({ ok: true, value: "complete" });
		expect(registry.activeCount).toBe(0);
	});

	test("cancels only operations owned by the requesting sender", async () => {
		const registry = new GitOperationRegistry();
		const owner = {};
		const pending = registry.run({
			operation: "fetch",
			operationId: "fetch-1",
			owner,
			task: waitForAbort("fetch"),
		});

		expect(registry.activeCount).toBe(1);
		expect(registry.cancel("fetch-1", {})).toEqual({
			operationId: "fetch-1",
			status: "not-found",
		});
		expect(registry.cancel("fetch-1", owner)).toEqual({
			operationId: "fetch-1",
			status: "cancelled",
		});
		expect(await pending).toEqual(abortedResult("fetch"));
		expect(registry.activeCount).toBe(0);
	});

	test("rejects duplicate active operation IDs", async () => {
		const registry = new GitOperationRegistry();
		const owner = {};
		const first = registry.run({
			operation: "fetch",
			operationId: "shared-id",
			owner,
			task: waitForAbort("fetch"),
		});

		const duplicate = await registry.run({
			operation: "push",
			operationId: "shared-id",
			owner,
			task: () => Promise.resolve({ ok: true, value: "unexpected" }),
		});

		expect(duplicate).toMatchObject({
			error: {
				code: "already-exists",
				operation: "push",
			},
			ok: false,
		});
		registry.cancel("shared-id", owner);
		await first;
	});

	test("rejects malformed operation IDs before starting work", async () => {
		const registry = new GitOperationRegistry();
		let taskStarted = false;

		const result = await registry.run({
			operation: "pull",
			operationId: "contains spaces",
			owner: {},
			task: () => {
				taskStarted = true;
				return Promise.resolve({ ok: true, value: "unexpected" });
			},
		});

		expect(result).toMatchObject({
			error: {
				code: "invalid-input",
				operation: "pull",
			},
			ok: false,
		});
		expect(taskStarted).toBe(false);
	});

	test("aborts all work for one owner without affecting another", async () => {
		const registry = new GitOperationRegistry();
		const firstOwner = {};
		const secondOwner = {};
		const first = registry.run({
			operation: "fetch",
			operationId: "first",
			owner: firstOwner,
			task: waitForAbort("fetch"),
		});
		const second = registry.run({
			operation: "push",
			operationId: "second",
			owner: secondOwner,
			task: waitForAbort("push"),
		});

		expect(registry.abortAll(firstOwner)).toBe(1);
		expect(await first).toEqual(abortedResult("fetch"));
		expect(registry.activeCount).toBe(1);
		registry.abortAll();
		expect(await second).toEqual(abortedResult("push"));
		expect(registry.activeCount).toBe(0);
	});

	test("accepts UUID-compatible operation IDs", () => {
		expect(isValidGitOperationId("019faefd-736c-70d2-a73f-c2b125385365")).toBe(
			true
		);
		expect(isValidGitOperationId("bad/id")).toBe(false);
	});
});

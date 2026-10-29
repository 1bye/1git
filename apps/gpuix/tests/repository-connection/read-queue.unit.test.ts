/**
 * Covers: bounded repository loading, in-flight sharing, queued priorities and independent cancellation.
 * Real: repository read queue.
 * Doubles: deferred repository reader; no Git, SSH or graphics.
 * Requires: none.
 */
import { expect, it, mock } from "bun:test";
import { RepositoryReadQueue } from "../../src/feature/repository-workspace/lib/repository-read-queue";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import { repositorySnapshot } from "../_shared/repository-snapshot";

type Result = Awaited<ReturnType<typeof RepositoryReader.read>>;
const result: Result = { ok: true, value: repositorySnapshot() };

it("limits concurrent reads and prioritizes the newly selected queued repository", async () => {
	const pending = Array.from({ length: 4 }, () =>
		Promise.withResolvers<Result>()
	);

	let index = 0;

	const reader = mock<typeof RepositoryReader.read>(
		() => pending[index++]!.promise
	);

	const queue = new RepositoryReadQueue(reader);

	const reads = ["/active", "/second", "/third", "/fourth"].map((path) =>
		queue.read(path, new AbortController().signal)
	);

	expect(reader.mock.calls.map(([path]) => path)).toEqual([
		"/active",
		"/second",
	]);
	queue.prioritize("/fourth");
	pending[0]!.resolve(result);
	await reads[0];
	expect(reader.mock.calls.map(([path]) => path)).toEqual([
		"/active",
		"/second",
		"/fourth",
	]);
	pending[1]!.resolve(result);
	await reads[1];
	expect(reader.mock.calls.map(([path]) => path)).toEqual([
		"/active",
		"/second",
		"/fourth",
		"/third",
	]);
	pending[2]!.resolve(result);
	pending[3]!.resolve(result);
	await Promise.all(reads);
});

it("shares a read without aborting it when only one tab closes", async () => {
	const pending = Promise.withResolvers<Result>();
	const reader = mock<typeof RepositoryReader.read>(() => pending.promise);
	const queue = new RepositoryReadQueue(reader);
	const closed = new AbortController();
	const first = queue.read("/shared", closed.signal);
	const second = queue.read("/shared", new AbortController().signal);

	closed.abort();
	await expect(first).rejects.toThrow();
	expect(reader).toHaveBeenCalledTimes(1);
	expect(reader.mock.calls[0]![1].aborted).toBe(false);
	pending.resolve(result);
	expect(await second).toEqual(result);
});

it("cancels abandoned reads and never starts a closed queued tab", async () => {
	const pending = Promise.withResolvers<Result>();
	const reader = mock<typeof RepositoryReader.read>(() => pending.promise);
	const queue = new RepositoryReadQueue(reader);
	const controllers = Array.from({ length: 3 }, () => new AbortController());

	const reads = controllers.map((controller, index) =>
		queue.read(`/repo-${index}`, controller.signal)
	);

	const settled = Promise.allSettled(reads);

	for (const controller of controllers) controller.abort();

	pending.resolve(result);
	await settled;

	expect(reader).toHaveBeenCalledTimes(2);
	expect(reader.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
});

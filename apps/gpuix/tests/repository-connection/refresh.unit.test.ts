/**
 * Covers: burst coalescing, in-flight invalidation, pause/cancellation, failures and disposal.
 * Real: repository refresh queue and timers.
 * Doubles: repository read callback; no filesystem or Git.
 * Requires: none.
 */
import { afterEach, expect, it, mock } from "bun:test";
import { RepositoryRefresh } from "../../src/feature/repository-workspace/lib/repository-refresh";

const queues: RepositoryRefresh[] = [];

afterEach(() => {
	for (const queue of queues) queue.dispose();

	queues.length = 0;
});

it("coalesces bursts and drains exactly one queued update after an in-flight read", async () => {
	const pending = Promise.withResolvers<void>();
	const read = mock(async () => await pending.promise);
	const error = mock();
	const queue = new RepositoryRefresh(read, error);

	queues.push(queue);
	queue.invalidate();
	queue.invalidate();
	queue.invalidate();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(1);
	queue.invalidate();
	queue.invalidate();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(1);
	pending.resolve();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(2);
	expect(error).not.toHaveBeenCalled();
});

it("aborts stale reads while paused, resumes once, and releases pending work on disposal", async () => {
	const pending = Promise.withResolvers<void>();
	const signals: AbortSignal[] = [];

	const read = mock(async (signal: AbortSignal) => {
		signals.push(signal);
		await pending.promise;
	});

	const queue = new RepositoryRefresh(read, mock());

	queues.push(queue);
	queue.invalidate();
	await Bun.sleep(300);
	queue.setPaused(true);
	queue.invalidate();
	expect(signals[0]?.aborted).toBe(true);
	pending.resolve();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(1);
	queue.setPaused(false);
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(2);
	queue.invalidate();
	queue.dispose();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(2);
});

it("bounds continuous bursts and recovers after a failed refresh", async () => {
	const read = mock(async (): Promise<void> => {
		throw new Error("Temporary failure");
	});

	const error = mock();
	const queue = new RepositoryRefresh(read, error);

	queues.push(queue);

	for (let index = 0; index < 6; index += 1) {
		queue.invalidate();
		await Bun.sleep(180);
	}

	expect(read).toHaveBeenCalledTimes(1);
	expect(error).toHaveBeenCalledWith("Temporary failure");
	read.mockImplementation(async () => {});
	queue.invalidate();
	await Bun.sleep(300);
	expect(read).toHaveBeenCalledTimes(2);
});

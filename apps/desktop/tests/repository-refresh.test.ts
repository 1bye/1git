import { describe, expect, test } from "bun:test";
import { createRepositoryRefreshDebouncer } from "../src/renderer/src/use-repository-refresh.js";
import type { RepositoryRefreshEvent } from "../src/shared/git-ipc.js";

const mutationEvent = (
	sessionId: string,
	operation: "commit" | "stage"
): RepositoryRefreshEvent => ({
	occurredAt: "2026-07-29T18:00:00.000Z",
	operation,
	sessionId,
	source: "mutation",
});

describe("repository refresh debouncer", () => {
	test("coalesces a burst to the latest event for each session", () => {
		const received: RepositoryRefreshEvent[] = [];
		const debouncer = createRepositoryRefreshDebouncer((event) => {
			received.push(event);
		});
		const latestFirstSession = mutationEvent("session-1", "commit");
		const secondSession = mutationEvent("session-2", "stage");

		debouncer.schedule(mutationEvent("session-1", "stage"));
		debouncer.schedule(latestFirstSession);
		debouncer.schedule(secondSession);
		debouncer.flush();

		expect(received).toEqual([latestFirstSession, secondSession]);
		debouncer.dispose();
	});

	test("dispose cancels pending refreshes", () => {
		const received: RepositoryRefreshEvent[] = [];
		const debouncer = createRepositoryRefreshDebouncer((event) => {
			received.push(event);
		});

		debouncer.schedule(mutationEvent("session-1", "stage"));
		debouncer.dispose();
		debouncer.flush();

		expect(received).toEqual([]);
	});

	test("rejects invalid debounce delays", () => {
		expect(() => createRepositoryRefreshDebouncer(() => undefined, -1)).toThrow(
			"Repository refresh delay must be a non-negative number."
		);
	});
});

import { describe, expect, test } from "bun:test";
import {
	publishActiveRepositoryFocus,
	publishRepositoryMutation,
} from "../src/main/git/repository-events.js";
import type { RepositoryManager } from "../src/main/git/repository-manager.js";
import {
	GIT_IPC_CHANNELS,
	GIT_IPC_EVENTS,
	type RepositoryRefreshEvent,
	repositoryMutationOperationForChannel,
} from "../src/shared/git-ipc.js";

interface SentEvent {
	readonly channel: string;
	readonly event: RepositoryRefreshEvent;
}

const createTarget = (): {
	readonly events: SentEvent[];
	readonly target: {
		readonly send: (channel: string, event: RepositoryRefreshEvent) => void;
	};
} => {
	const events: SentEvent[] = [];
	return {
		events,
		target: {
			send: (channel, event) => {
				events.push({ channel, event });
			},
		},
	};
};

describe("repository events", () => {
	test("classifies repository writes without classifying queries", () => {
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.changes.changeHunk)
		).toBe("change-hunk");
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.changes.commit)
		).toBe("commit");
		expect(
			repositoryMutationOperationForChannel(
				GIT_IPC_CHANNELS.changes.undoHunkDiscard
			)
		).toBe("undo-hunk-discard");
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.branches.merge)
		).toBe("merge");
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.sync.fetch)
		).toBe("fetch");
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.worktrees.repair)
		).toBe("repair-worktrees");
		expect(
			repositoryMutationOperationForChannel(
				GIT_IPC_CHANNELS.repository.snapshot
			)
		).toBeUndefined();
		expect(
			repositoryMutationOperationForChannel(GIT_IPC_CHANNELS.branches.list)
		).toBeUndefined();
	});

	test("publishes structured mutation metadata", () => {
		const { events, target } = createTarget();

		publishRepositoryMutation(
			target,
			{
				operation: "stage",
				operationId: "stage-1",
				sessionId: "session-1",
			},
			() => "2026-07-29T18:00:00.000Z"
		);

		expect(events).toEqual([
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				event: {
					occurredAt: "2026-07-29T18:00:00.000Z",
					operation: "stage",
					operationId: "stage-1",
					sessionId: "session-1",
					source: "mutation",
				},
			},
		]);
	});

	test("publishes focus refreshes only for an active repository", () => {
		const { events, target } = createTarget();
		const inactiveManager = {
			getActiveSession: () => null,
		} satisfies Pick<RepositoryManager, "getActiveSession">;
		const activeManager = {
			getActiveSession: () => ({
				id: "session-1",
				lastActivatedAt: "2026-07-29T17:59:00.000Z",
				openedAt: "2026-07-29T17:59:00.000Z",
				repository: {
					commonDirectory: "/repository/.git",
					gitDirectory: "/repository/.git",
					isBare: false,
					isShallow: false,
					root: "/repository",
				},
			}),
		} satisfies Pick<RepositoryManager, "getActiveSession">;

		expect(
			publishActiveRepositoryFocus(
				target,
				inactiveManager,
				() => "2026-07-29T18:00:00.000Z"
			)
		).toBe(false);
		expect(
			publishActiveRepositoryFocus(
				target,
				activeManager,
				() => "2026-07-29T18:00:01.000Z"
			)
		).toBe(true);
		expect(events).toEqual([
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				event: {
					occurredAt: "2026-07-29T18:00:01.000Z",
					sessionId: "session-1",
					source: "window-focus",
				},
			},
		]);
	});
});

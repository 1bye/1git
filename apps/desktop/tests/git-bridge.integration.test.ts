import { afterEach, describe, expect, test } from "bun:test";

import type { GitResult, RepositorySnapshot } from "@1git/git";

import {
	GIT_IPC_CHANNELS,
	type RepositoryRefreshEvent,
} from "../src/shared/git-ipc.js";
import type { OpenedRepositorySession } from "../src/shared/repository-session.js";
import { DesktopGitBridgeHarness } from "./_shared/desktop-git-bridge-harness.js";
import {
	createTestRepositoryManager,
	RepositoryFixtures,
} from "./_shared/repository-manager-fixture.js";

const fixtures = new RepositoryFixtures();
const bridges = new Set<DesktopGitBridgeHarness>();

const createBridge = (): DesktopGitBridgeHarness => {
	const bridge = new DesktopGitBridgeHarness(createTestRepositoryManager());
	bridges.add(bridge);
	return bridge;
};

const unwrapGitResult = <T>(result: GitResult<T>): T => {
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
};

afterEach(async () => {
	for (const bridge of bridges) {
		bridge.dispose();
	}
	bridges.clear();
	await fixtures.cleanup();
});

describe("desktop Git bridge", () => {
	test("returns structured errors for malformed IPC envelopes", async () => {
		const bridge = createBridge();

		const missingSession = await bridge.invokeRaw<
			GitResult<RepositorySnapshot>
		>(GIT_IPC_CHANNELS.repository.snapshot, { input: {} });
		const malformedInput = await bridge.invokeRaw<
			GitResult<RepositorySnapshot>
		>(GIT_IPC_CHANNELS.repository.snapshot, {
			input: "not-an-object",
			sessionId: "session-1",
		});
		const malformedOperationId = await bridge.invokeRaw<
			GitResult<RepositorySnapshot>
		>(GIT_IPC_CHANNELS.repository.snapshot, {
			input: {},
			operationId: {},
			sessionId: "session-1",
		});

		expect(missingSession).toEqual({
			error: {
				code: "invalid-input",
				message: "sessionId must be a non-empty string.",
				operation: "get-snapshot",
				retryable: false,
			},
			ok: false,
		});
		expect(malformedInput).toEqual({
			error: {
				code: "invalid-input",
				message: "Git IPC input must be an object.",
				operation: "get-snapshot",
				retryable: false,
			},
			ok: false,
		});
		expect(malformedOperationId).toEqual({
			error: {
				code: "invalid-input",
				message: "operationId must be a non-empty string.",
				operation: "get-snapshot",
				retryable: false,
			},
			ok: false,
		});
		expect(
			JSON.parse(
				JSON.stringify({
					malformedInput,
					malformedOperationId,
					missingSession,
				})
			)
		).toEqual({
			malformedInput,
			malformedOperationId,
			missingSession,
		});
	});

	test("returns a structured error for malformed repository opening", async () => {
		const bridge = createBridge();

		const result = await bridge.invokeRaw<GitResult<OpenedRepositorySession>>(
			GIT_IPC_CHANNELS.sessions.open,
			{
				path: 42,
				runtime: { executable: "renderer-git" },
			}
		);

		expect(result).toEqual({
			error: {
				code: "invalid-input",
				message: "path must be a non-empty string.",
				operation: "open-repository",
				retryable: false,
			},
			ok: false,
		});
		expect(bridge.ipc.repositoryManager.getState().sessions).toEqual([]);
	});

	test("does not grant access to unknown or foreign session IDs", async () => {
		const firstBridge = createBridge();
		const secondBridge = createBridge();
		const fixture = await fixtures.create();
		const opened = unwrapGitResult(
			await firstBridge.api.sessions.open({ path: fixture.repositoryPath })
		);

		const snapshot = await secondBridge.api.repository.snapshot(
			opened.session.id
		);
		const stage = await secondBridge.api.changes.stage(opened.session.id, {
			paths: ["README.md"],
		});
		const commit = await secondBridge.api.changes.commit(opened.session.id, {
			summary: "Must not commit",
		});
		const activation = await secondBridge.api.sessions.activate(
			opened.session.id
		);

		expect(snapshot).toMatchObject({
			error: { code: "not-found", operation: "get-snapshot" },
			ok: false,
		});
		expect(stage).toMatchObject({
			error: { code: "not-found", operation: "stage" },
			ok: false,
		});
		expect(commit).toMatchObject({
			error: { code: "not-found", operation: "commit" },
			ok: false,
		});
		expect(activation).toEqual({
			error: {
				code: "session-not-found",
				message: `Repository session "${opened.session.id}" was not found.`,
				sessionId: opened.session.id,
			},
			ok: false,
		});
		expect(secondBridge.ipc.sentRendererMessages).toEqual([]);
	});

	test("opens, snapshots, stages, and commits through the preload bridge", async () => {
		const bridge = createBridge();
		const fixture = await fixtures.create();
		const refreshEvents: RepositoryRefreshEvent[] = [];
		const unsubscribe = bridge.api.events.onRepositoryRefresh((event) => {
			refreshEvents.push(event);
		});

		const opened = unwrapGitResult(
			await bridge.api.sessions.open({ path: fixture.repositoryPath })
		);
		const initialSnapshot = unwrapGitResult(
			await bridge.api.repository.snapshot(opened.session.id)
		);
		await fixture.write(
			"src/bridge.ts",
			"export const crossedBridge = true;\n"
		);
		const workingSnapshot = unwrapGitResult(
			await bridge.api.repository.snapshot(opened.session.id)
		);
		const stagedSnapshot = unwrapGitResult(
			await bridge.api.changes.stage(opened.session.id, {
				paths: ["src/bridge.ts"],
			})
		);
		const committed = unwrapGitResult(
			await bridge.api.changes.commit(opened.session.id, {
				summary: "Test complete desktop bridge",
			})
		);
		const finalSnapshot = unwrapGitResult(
			await bridge.api.repository.snapshot(opened.session.id)
		);
		const history = unwrapGitResult(
			await bridge.api.repository.history(opened.session.id, { limit: 10 })
		);
		unsubscribe();

		expect(initialSnapshot.files).toEqual([]);
		expect(workingSnapshot.files).toContainEqual(
			expect.objectContaining({
				indexStatus: "unmodified",
				path: "src/bridge.ts",
				worktreeStatus: "untracked",
			})
		);
		expect(stagedSnapshot.files).toContainEqual(
			expect.objectContaining({
				indexStatus: "added",
				path: "src/bridge.ts",
			})
		);
		expect(committed).toMatchObject({
			commit: { summary: "Test complete desktop bridge" },
			snapshot: { files: [] },
		});
		expect(finalSnapshot.files).toEqual([]);
		expect(history.commits[0]?.summary).toBe("Test complete desktop bridge");
		expect(refreshEvents).toEqual([
			{
				occurredAt: expect.any(String),
				operation: "stage",
				operationId: expect.any(String),
				sessionId: opened.session.id,
				source: "mutation",
			},
			{
				occurredAt: expect.any(String),
				operation: "commit",
				operationId: expect.any(String),
				sessionId: opened.session.id,
				source: "mutation",
			},
		]);
		expect(
			JSON.parse(
				JSON.stringify({
					committed,
					finalSnapshot,
					history,
					initialSnapshot,
					opened,
					stagedSnapshot,
					workingSnapshot,
				})
			)
		).toEqual({
			committed,
			finalSnapshot,
			history,
			initialSnapshot,
			opened,
			stagedSnapshot,
			workingSnapshot,
		});
	});

	test("changes individual hunks through the preload bridge", async () => {
		const bridge = createBridge();
		const fixture = await fixtures.create();
		const opened = unwrapGitResult(
			await bridge.api.sessions.open({ path: fixture.repositoryPath })
		);
		const originalLines = Array.from(
			{ length: 20 },
			(_, index) => `line ${index + 1}`
		);
		await fixture.write("hunks.txt", `${originalLines.join("\n")}\n`);
		unwrapGitResult(
			await bridge.api.changes.stage(opened.session.id, {
				paths: ["hunks.txt"],
			})
		);
		unwrapGitResult(
			await bridge.api.changes.commit(opened.session.id, {
				summary: "Add hunk fixture",
			})
		);
		const changedLines = [...originalLines];
		changedLines[1] = "line 2 changed";
		changedLines[17] = "line 18 changed";
		await fixture.write("hunks.txt", `${changedLines.join("\n")}\n`);

		unwrapGitResult(
			await bridge.api.changes.changeHunk(opened.session.id, {
				action: "stage",
				hunkIndex: 0,
				path: "hunks.txt",
			})
		);
		const stagedDiff = unwrapGitResult(
			await bridge.api.repository.diff(opened.session.id, {
				paths: ["hunks.txt"],
				target: { kind: "staged" },
			})
		);
		const workingDiff = unwrapGitResult(
			await bridge.api.repository.diff(opened.session.id, {
				paths: ["hunks.txt"],
				target: { kind: "working" },
			})
		);

		expect(stagedDiff.patch).toContain("line 2 changed");
		expect(stagedDiff.patch).not.toContain("line 18 changed");
		expect(workingDiff.patch).toContain("line 18 changed");
		expect(workingDiff.patch).not.toContain("line 2 changed");

		const discarded = unwrapGitResult(
			await bridge.api.changes.changeHunk(opened.session.id, {
				action: "discard",
				allowDestructive: true,
				hunkIndex: 0,
				path: "hunks.txt",
			})
		);
		expect(discarded.undo).toMatchObject({ path: "hunks.txt" });
		unwrapGitResult(
			await bridge.api.changes.undoDiscard(opened.session.id, {
				token: discarded.undo?.token ?? "",
			})
		);
		const restoredDiff = unwrapGitResult(
			await bridge.api.repository.diff(opened.session.id, {
				paths: ["hunks.txt"],
				target: { kind: "working" },
			})
		);
		expect(restoredDiff.patch).toContain("line 18 changed");
	});

	test("keeps manager state structured after a bridge session closes", async () => {
		const bridge = createBridge();
		const fixture = await fixtures.create();
		const opened = unwrapGitResult(
			await bridge.api.sessions.open({ path: fixture.repositoryPath })
		);

		const state = await bridge.api.sessions.close(opened.session.id);
		const laterSnapshot = await bridge.api.repository.snapshot(
			opened.session.id
		);

		expect(state).toMatchObject({
			ok: true,
			value: {
				activeSessionId: null,
				sessions: [],
			},
		});
		expect(laterSnapshot).toMatchObject({
			error: {
				code: "not-found",
				operation: "get-snapshot",
			},
			ok: false,
		});
	});
});

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type {
	BranchCollection,
	BranchMutationResult,
	CommitPage,
	CommitResult,
	ConfigValue,
	GitResult,
	RemoteInfo,
	RepositorySnapshot,
	SyncResult,
	TagInfo,
	WorktreeInfo,
} from "@1git/git";
import { GIT_IPC_CHANNELS, GIT_IPC_EVENTS } from "../src/shared/git-ipc.js";
import type {
	OpenedRepositorySession,
	RepositoryManagerResult,
	RepositoryManagerState,
} from "../src/shared/repository-session.js";
import { GitIpcHarness } from "./_shared/git-ipc-harness.js";
import {
	createTestRepositoryManager,
	RepositoryFixtures,
	unwrapManagerResult,
} from "./_shared/repository-manager-fixture.js";

const fixtures = new RepositoryFixtures();
const harnesses = new Set<GitIpcHarness>();

afterEach(async () => {
	for (const harness of harnesses) {
		harness.dispose();
	}
	harnesses.clear();
	await fixtures.cleanup();
});

const createHarness = (): GitIpcHarness => {
	const harness = new GitIpcHarness(createTestRepositoryManager());
	harnesses.add(harness);
	return harness;
};

const unwrapGitResult = <T>(result: GitResult<T>): T => {
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
};

const openFixture = async (
	harness: GitIpcHarness
): Promise<{
	readonly opened: OpenedRepositorySession;
	readonly repositoryPath: string;
	readonly root: string;
}> => {
	const fixture = await fixtures.create();
	const result = await harness.invoke<GitResult<OpenedRepositorySession>>(
		GIT_IPC_CHANNELS.sessions.open,
		{ path: fixture.repositoryPath }
	);
	return {
		opened: unwrapGitResult(result),
		repositoryPath: fixture.repositoryPath,
		root: fixture.root,
	};
};

describe("Git IPC repository workflow", () => {
	test("opens a session and reads structured snapshot and history data", async () => {
		const harness = createHarness();
		const { opened } = await openFixture(harness);

		const snapshot = unwrapGitResult(
			await harness.invoke<GitResult<RepositorySnapshot>>(
				GIT_IPC_CHANNELS.repository.snapshot,
				{ input: {}, sessionId: opened.session.id }
			)
		);
		const history = unwrapGitResult(
			await harness.invoke<GitResult<CommitPage>>(
				GIT_IPC_CHANNELS.repository.history,
				{ input: { limit: 10 }, sessionId: opened.session.id }
			)
		);

		expect(snapshot.repository).toEqual(opened.session.repository);
		expect(history.commits[0]?.summary).toBe("Initial commit");
		expect(JSON.parse(JSON.stringify({ history, snapshot }))).toEqual({
			history,
			snapshot,
		});
		expect(harness.sentRendererMessages).toEqual([]);
	});

	test("strips renderer-owned runtime and cancellation objects", async () => {
		const harness = createHarness();
		const { opened } = await openFixture(harness);

		const snapshot = await harness.invoke<GitResult<RepositorySnapshot>>(
			GIT_IPC_CHANNELS.repository.snapshot,
			{
				input: {
					runtime: { executable: "renderer-controlled-git" },
					signal: { aborted: true },
				},
				sessionId: opened.session.id,
			}
		);

		expect(snapshot).toMatchObject({
			ok: true,
			value: {
				repository: opened.session.repository,
			},
		});
	});

	test("stages and commits changes through explicit channels", async () => {
		const harness = createHarness();
		const fixture = await fixtures.create();
		const opened = unwrapGitResult(
			await harness.invoke<GitResult<OpenedRepositorySession>>(
				GIT_IPC_CHANNELS.sessions.open,
				{ path: fixture.repositoryPath }
			)
		);
		await fixture.write("src/ipc.ts", "export const ipc = true;\n");

		const staged = unwrapGitResult(
			await harness.invoke<GitResult<RepositorySnapshot>>(
				GIT_IPC_CHANNELS.changes.stage,
				{
					input: { paths: ["src/ipc.ts"] },
					operationId: "stage-ipc",
					sessionId: opened.session.id,
				}
			)
		);
		const committed = unwrapGitResult(
			await harness.invoke<GitResult<CommitResult>>(
				GIT_IPC_CHANNELS.changes.commit,
				{
					input: { summary: "Add typed IPC" },
					operationId: "commit-ipc",
					sessionId: opened.session.id,
				}
			)
		);

		expect(staged.files[0]).toMatchObject({
			indexStatus: "added",
			path: "src/ipc.ts",
		});
		expect(committed.commit.summary).toBe("Add typed IPC");
		expect(committed.snapshot.files).toEqual([]);
		expect(harness.sentRendererMessages).toEqual([
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				payload: {
					occurredAt: expect.any(String),
					operation: "stage",
					operationId: "stage-ipc",
					sessionId: opened.session.id,
					source: "mutation",
				},
			},
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				payload: {
					occurredAt: expect.any(String),
					operation: "commit",
					operationId: "commit-ipc",
					sessionId: opened.session.id,
					source: "mutation",
				},
			},
		]);
	});

	test("creates and lists branches without exposing repository objects", async () => {
		const harness = createHarness();
		const { opened } = await openFixture(harness);

		const created = unwrapGitResult(
			await harness.invoke<GitResult<BranchMutationResult>>(
				GIT_IPC_CHANNELS.branches.create,
				{
					input: { name: "feature/ipc" },
					sessionId: opened.session.id,
				}
			)
		);
		const branches = unwrapGitResult(
			await harness.invoke<GitResult<BranchCollection>>(
				GIT_IPC_CHANNELS.branches.list,
				{ sessionId: opened.session.id }
			)
		);

		expect(created.branches.branches).toContainEqual(
			expect.objectContaining({ name: "feature/ipc", type: "local" })
		);
		expect(
			branches.branches.some((branch) => branch.name === "feature/ipc")
		).toBe(true);
		expect(JSON.parse(JSON.stringify(created))).toEqual(created);
	});

	test("uses explicit remote and synchronization channels", async () => {
		const harness = createHarness();
		const local = await openFixture(harness);
		const remote = await fixtures.create();

		const remotes = unwrapGitResult(
			await harness.invoke<GitResult<readonly RemoteInfo[]>>(
				GIT_IPC_CHANNELS.remotes.add,
				{
					input: { name: "origin", url: remote.repositoryPath },
					sessionId: local.opened.session.id,
				}
			)
		);
		const fetched = unwrapGitResult(
			await harness.invoke<GitResult<SyncResult>>(GIT_IPC_CHANNELS.sync.fetch, {
				input: { remote: "origin" },
				sessionId: local.opened.session.id,
			})
		);

		expect(remotes).toEqual([
			{
				fetchUrls: [remote.repositoryPath],
				name: "origin",
				pushUrls: [remote.repositoryPath],
			},
		]);
		expect(fetched).toMatchObject({
			operation: "fetch",
			remote: "origin",
		});
	});

	test("uses explicit tag, config, and worktree channels", async () => {
		const harness = createHarness();
		const { opened, root } = await openFixture(harness);

		const tags = unwrapGitResult(
			await harness.invoke<GitResult<readonly TagInfo[]>>(
				GIT_IPC_CHANNELS.tags.create,
				{
					input: { name: "v0.1.0" },
					sessionId: opened.session.id,
				}
			)
		);
		const config = unwrapGitResult(
			await harness.invoke<GitResult<ConfigValue>>(
				GIT_IPC_CHANNELS.config.set,
				{
					input: { key: "onegit.view", value: "changes" },
					sessionId: opened.session.id,
				}
			)
		);
		const worktrees = unwrapGitResult(
			await harness.invoke<GitResult<readonly WorktreeInfo[]>>(
				GIT_IPC_CHANNELS.worktrees.create,
				{
					input: {
						newBranch: "feature/worktree",
						path: join(root, "linked-worktree"),
					},
					sessionId: opened.session.id,
				}
			)
		);

		expect(tags[0]).toMatchObject({ name: "v0.1.0" });
		expect(config).toEqual({
			key: "onegit.view",
			scope: "local",
			value: "changes",
		});
		expect(worktrees).toHaveLength(2);
	});

	test("initializes and clones repositories as serializable sessions", async () => {
		const harness = createHarness();
		const source = await fixtures.create();
		const initializePath = join(source.root, "initialized");
		const clonePath = join(source.root, "cloned");

		const initialized = unwrapGitResult(
			await harness.invoke<GitResult<OpenedRepositorySession>>(
				GIT_IPC_CHANNELS.sessions.initialize,
				{ initialBranch: "trunk", path: initializePath }
			)
		);
		const cloned = unwrapGitResult(
			await harness.invoke<GitResult<OpenedRepositorySession>>(
				GIT_IPC_CHANNELS.sessions.clone,
				{ path: clonePath, remoteUrl: source.repositoryPath }
			)
		);

		expect(initialized.snapshot.head).toMatchObject({
			branch: "trunk",
			unborn: true,
		});
		expect(cloned.snapshot.head.branch).toBe("main");
		expect(JSON.parse(JSON.stringify({ cloned, initialized }))).toEqual({
			cloned,
			initialized,
		});
		expect(harness.sentRendererMessages).toEqual([
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				payload: {
					occurredAt: expect.any(String),
					operation: "initialize-repository",
					sessionId: initialized.session.id,
					source: "mutation",
				},
			},
			{
				channel: GIT_IPC_EVENTS.repositoryRefresh,
				payload: {
					occurredAt: expect.any(String),
					operation: "clone-repository",
					sessionId: cloned.session.id,
					source: "mutation",
				},
			},
		]);
	});

	test("closes a session and prevents later repository operations", async () => {
		const harness = createHarness();
		const { opened } = await openFixture(harness);

		const state = unwrapManagerResult(
			await harness.invoke<RepositoryManagerResult<RepositoryManagerState>>(
				GIT_IPC_CHANNELS.sessions.close,
				{ sessionId: opened.session.id }
			)
		);
		const result = await harness.invoke<GitResult<RepositorySnapshot>>(
			GIT_IPC_CHANNELS.repository.snapshot,
			{ input: {}, sessionId: opened.session.id }
		);

		expect(state.activeSessionId).toBeNull();
		expect(result).toMatchObject({
			error: { code: "not-found" },
			ok: false,
		});
	});
});

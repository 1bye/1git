import { afterEach, describe, expect, test } from "bun:test";
import {
	createTestRepositoryManager,
	RepositoryFixtures,
	unwrapManagerResult,
} from "./_shared/repository-manager-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("RepositoryManager opening", () => {
	test("opens a repository and returns only serializable records", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();

		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);

		expect(opened.session).toEqual({
			id: "session-1",
			lastActivatedAt: "2026-01-01T00:00:00.000Z",
			openedAt: "2026-01-01T00:00:00.000Z",
			repository: opened.snapshot.repository,
		});
		expect(JSON.parse(JSON.stringify(opened))).toEqual(opened);
		expect(
			Object.values(opened.session).every(
				(value) => typeof value !== "function"
			)
		).toBe(true);
	});

	test("makes a newly opened repository active and recent", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();

		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);

		expect(manager.getState()).toMatchObject({
			activeSessionId: opened.session.id,
			recentRepositories: [{ path: fixture.repositoryPath }],
			sessions: [{ id: opened.session.id }],
		});
		expect(manager.getActiveSession()).toEqual(opened.session);
	});

	test("deduplicates paths inside the same canonical repository", async () => {
		const fixture = await fixtures.create();
		const nestedFile = await fixture.write("src/nested.ts", "export {};\n");
		const manager = createTestRepositoryManager();

		const first = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: nestedFile })
		);

		expect(second.session.id).toBe(first.session.id);
		expect(second.session.openedAt).toBe(first.session.openedAt);
		expect(second.session.lastActivatedAt).not.toBe(
			first.session.lastActivatedAt
		);
		expect(manager.getState().sessions).toHaveLength(1);
	});

	test("serializes concurrent opens of the same repository", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();

		const [firstResult, secondResult] = await Promise.all([
			manager.openRepository({ path: fixture.repositoryPath }),
			manager.openRepository({ path: fixture.repositoryPath }),
		]);
		const first = unwrapManagerResult(firstResult);
		const second = unwrapManagerResult(secondResult);

		expect(first.session.id).toBe(second.session.id);
		expect(manager.getState().sessions).toHaveLength(1);
	});

	test("assigns different opaque IDs to different repositories", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const manager = createTestRepositoryManager();

		const first = unwrapManagerResult(
			await manager.openRepository({ path: firstFixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: secondFixture.repositoryPath })
		);

		expect(first.session.id).toBe("session-1");
		expect(second.session.id).toBe("session-2");
		expect(manager.getState().sessions).toHaveLength(2);
	});

	test("retries colliding or empty session IDs", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const candidates = ["session", "", "session", "second-session"];
		let candidateIndex = 0;
		const manager = createTestRepositoryManager({
			createSessionId: () => {
				const candidate = candidates[candidateIndex] ?? "fallback";
				candidateIndex += 1;
				return candidate;
			},
		});

		const first = unwrapManagerResult(
			await manager.openRepository({ path: firstFixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: secondFixture.repositoryPath })
		);

		expect(first.session.id).toBe("session");
		expect(second.session.id).toBe("second-session");
	});

	test("returns a structured Git error for a non-repository", async () => {
		const path = await fixtures.createNonRepository();
		const manager = createTestRepositoryManager();

		const result = await manager.openRepository({ path });

		expect(result).toMatchObject({
			error: {
				code: "git-error",
				gitError: { code: "not-a-repository" },
			},
			ok: false,
		});
		expect(manager.getState()).toEqual({
			activeSessionId: null,
			recentRepositories: [],
			sessions: [],
		});
	});

	test("does not register an operation that was already aborted", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const controller = new AbortController();
		controller.abort();

		const result = await manager.openRepository({
			path: fixture.repositoryPath,
			signal: controller.signal,
		});

		expect(result).toMatchObject({
			error: {
				code: "git-error",
				gitError: { code: "aborted" },
			},
			ok: false,
		});
		expect(manager.getState().sessions).toHaveLength(0);
	});

	test("rejects invalid recent-repository limits", () => {
		expect(() =>
			createTestRepositoryManager({
				maxRecentRepositories: 0,
			})
		).toThrow("maxRecentRepositories must be a positive integer.");
	});
});

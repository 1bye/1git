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

describe("RepositoryManager state", () => {
	test("activates an existing session and moves it to the front", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const first = unwrapManagerResult(
			await manager.openRepository({ path: firstFixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: secondFixture.repositoryPath })
		);

		const state = unwrapManagerResult(
			manager.activateSession(first.session.id)
		);

		expect(state.activeSessionId).toBe(first.session.id);
		expect(state.sessions.map((session) => session.id)).toEqual([
			first.session.id,
			second.session.id,
		]);
		expect(
			state.recentRepositories.map((repository) => repository.path)
		).toEqual([firstFixture.repositoryPath, secondFixture.repositoryPath]);
		expect(state.sessions[0]?.lastActivatedAt).toBe("2026-01-01T00:00:02.000Z");
	});

	test("returns a structured error for an unknown activation", () => {
		const manager = createTestRepositoryManager();

		const result = manager.activateSession("missing");

		expect(result).toEqual({
			error: {
				code: "session-not-found",
				message: 'Repository session "missing" was not found.',
				sessionId: "missing",
			},
			ok: false,
		});
	});

	test("gets a serializable session without exposing its owner object", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);

		const session = unwrapManagerResult(manager.getSession(opened.session.id));

		expect(session).toEqual(opened.session);
		expect(JSON.parse(JSON.stringify(session))).toEqual(session);
		expect(Object.keys(session)).toEqual([
			"id",
			"lastActivatedAt",
			"openedAt",
			"repository",
		]);
	});

	test("returns a structured error for an unknown session lookup", () => {
		const manager = createTestRepositoryManager();

		expect(manager.getSession("missing")).toMatchObject({
			error: { code: "session-not-found", sessionId: "missing" },
			ok: false,
		});
	});

	test("closes an inactive session without changing the active session", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const first = unwrapManagerResult(
			await manager.openRepository({ path: firstFixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: secondFixture.repositoryPath })
		);

		const state = unwrapManagerResult(manager.closeSession(first.session.id));

		expect(state.activeSessionId).toBe(second.session.id);
		expect(state.sessions.map((session) => session.id)).toEqual([
			second.session.id,
		]);
		expect(state.recentRepositories).toHaveLength(2);
	});

	test("falls back to the most recently active remaining session", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const thirdFixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const first = unwrapManagerResult(
			await manager.openRepository({ path: firstFixture.repositoryPath })
		);
		const second = unwrapManagerResult(
			await manager.openRepository({ path: secondFixture.repositoryPath })
		);
		const third = unwrapManagerResult(
			await manager.openRepository({ path: thirdFixture.repositoryPath })
		);
		unwrapManagerResult(manager.activateSession(first.session.id));

		const state = unwrapManagerResult(manager.closeSession(first.session.id));

		expect(state.activeSessionId).toBe(third.session.id);
		expect(state.sessions.map((session) => session.id)).toEqual([
			third.session.id,
			second.session.id,
		]);
	});

	test("retains recent repositories after the last session closes", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);

		const state = unwrapManagerResult(manager.closeSession(opened.session.id));

		expect(state.activeSessionId).toBeNull();
		expect(state.sessions).toEqual([]);
		expect(state.recentRepositories).toEqual([
			{
				lastOpenedAt: "2026-01-01T00:00:00.000Z",
				path: fixture.repositoryPath,
			},
		]);
	});

	test("returns a structured error when closing an unknown session", () => {
		const manager = createTestRepositoryManager();

		expect(manager.closeSession("missing")).toMatchObject({
			error: { code: "session-not-found", sessionId: "missing" },
			ok: false,
		});
	});

	test("bounds recent repositories and keeps them most-recent-first", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const thirdFixture = await fixtures.create();
		const manager = createTestRepositoryManager({
			maxRecentRepositories: 2,
		});

		await manager.openRepository({ path: firstFixture.repositoryPath });
		await manager.openRepository({ path: secondFixture.repositoryPath });
		await manager.openRepository({ path: thirdFixture.repositoryPath });

		expect(
			manager.getState().recentRepositories.map((repository) => repository.path)
		).toEqual([thirdFixture.repositoryPath, secondFixture.repositoryPath]);
	});

	test("forgets a recent path without closing its active session", async () => {
		const fixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);

		const state = manager.forgetRecentRepository(fixture.repositoryPath);

		expect(state.recentRepositories).toEqual([]);
		expect(state.activeSessionId).toBe(opened.session.id);
		expect(state.sessions).toHaveLength(1);
	});

	test("releases all owned sessions while preserving recent history", async () => {
		const firstFixture = await fixtures.create();
		const secondFixture = await fixtures.create();
		const manager = createTestRepositoryManager();
		await manager.openRepository({ path: firstFixture.repositoryPath });
		await manager.openRepository({ path: secondFixture.repositoryPath });

		const state = manager.closeAllSessions();

		expect(state.activeSessionId).toBeNull();
		expect(state.sessions).toEqual([]);
		expect(state.recentRepositories).toHaveLength(2);
		expect(manager.getActiveSession()).toBeNull();
	});
});

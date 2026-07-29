import { afterEach, describe, expect, test } from "bun:test";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { RecentRepositoryStore } from "../src/main/git/recent-repository-store.js";
import type { RecentRepositoryRecord } from "../src/shared/repository-session.js";
import {
	createTestRepositoryManager,
	RepositoryFixtures,
	unwrapManagerResult,
} from "./_shared/repository-manager-fixture.js";

class MemoryRecentRepositoryStore implements RecentRepositoryStore {
	records: RecentRepositoryRecord[];
	readonly saves: RecentRepositoryRecord[][] = [];

	constructor(records: readonly RecentRepositoryRecord[] = []) {
		this.records = records.map((repository) => ({ ...repository }));
	}

	load(): readonly RecentRepositoryRecord[] {
		return this.records.map((repository) => ({ ...repository }));
	}

	save(repositories: readonly RecentRepositoryRecord[]): void {
		this.records = repositories.map((repository) => ({ ...repository }));
		this.saves.push(this.records);
	}
}

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("RepositoryManager recent repository persistence", () => {
	test("restores available paths and removes stale or duplicate records", async () => {
		const fixture = await fixtures.create();
		const store = new MemoryRecentRepositoryStore([
			{
				lastOpenedAt: "2026-01-01T00:00:02.000Z",
				path: fixture.repositoryPath,
			},
			{
				lastOpenedAt: "2026-01-01T00:00:01.000Z",
				path: join(fixture.root, "deleted"),
			},
			{
				lastOpenedAt: "2026-01-01T00:00:00.000Z",
				path: fixture.repositoryPath,
			},
		]);

		const manager = createTestRepositoryManager({
			recentRepositoryStore: store,
		});

		expect(manager.getState().recentRepositories).toEqual([
			{
				lastOpenedAt: "2026-01-01T00:00:02.000Z",
				path: fixture.repositoryPath,
			},
		]);
		expect(store.saves).toEqual([
			[
				{
					lastOpenedAt: "2026-01-01T00:00:02.000Z",
					path: fixture.repositoryPath,
				},
			],
		]);
	});

	test("persists canonical paths for the next manager instance", async () => {
		const fixture = await fixtures.create();
		const store = new MemoryRecentRepositoryStore();
		const manager = createTestRepositoryManager({
			recentRepositoryStore: store,
		});
		const nestedFile = await fixture.write(
			"nested/file.txt",
			"repository content\n"
		);

		await manager.openRepository({ path: nestedFile });
		const restoredManager = createTestRepositoryManager({
			recentRepositoryStore: store,
		});

		expect(restoredManager.getState().recentRepositories).toEqual([
			{
				lastOpenedAt: "2026-01-01T00:00:00.000Z",
				path: fixture.repositoryPath,
			},
		]);
	});

	test("prunes a moved path and accepts its new location when reopened", async () => {
		const fixture = await fixtures.create();
		const movedPath = join(fixture.root, "moved-repository");
		const store = new MemoryRecentRepositoryStore();
		const manager = createTestRepositoryManager({
			recentRepositoryStore: store,
		});
		const opened = unwrapManagerResult(
			await manager.openRepository({ path: fixture.repositoryPath })
		);
		unwrapManagerResult(manager.closeSession(opened.session.id));
		await rename(fixture.repositoryPath, movedPath);

		expect(manager.getState().recentRepositories).toEqual([]);

		const reopened = unwrapManagerResult(
			await manager.openRepository({ path: movedPath })
		);
		expect(reopened.session.repository.root).toBe(movedPath);
		expect(manager.getState().recentRepositories).toEqual([
			{
				lastOpenedAt: "2026-01-01T00:00:01.000Z",
				path: movedPath,
			},
		]);
	});

	test("persists explicit recent-repository removal", async () => {
		const fixture = await fixtures.create();
		const store = new MemoryRecentRepositoryStore();
		const manager = createTestRepositoryManager({
			recentRepositoryStore: store,
		});
		await manager.openRepository({ path: fixture.repositoryPath });

		manager.forgetRecentRepository(fixture.repositoryPath);

		expect(store.records).toEqual([]);
		expect(store.saves.at(-1)).toEqual([]);
	});

	test("reports storage failures without breaking repository opening", async () => {
		const fixture = await fixtures.create();
		const errors: Error[] = [];
		const store: RecentRepositoryStore = {
			load: () => [],
			save: () => {
				throw new Error("disk unavailable");
			},
		};
		const manager = createTestRepositoryManager({
			onPersistenceError: (error) => {
				errors.push(error);
			},
			recentRepositoryStore: store,
		});

		const result = await manager.openRepository({
			path: fixture.repositoryPath,
		});

		expect(result.ok).toBe(true);
		expect(errors.map((error) => error.message)).toEqual(["disk unavailable"]);
	});

	test("reports loading failures and starts with empty recent state", () => {
		const errors: Error[] = [];
		const store: RecentRepositoryStore = {
			load: () => {
				throw new Error("state unreadable");
			},
			save: () => undefined,
		};

		const manager = createTestRepositoryManager({
			onPersistenceError: (error) => {
				errors.push(error);
			},
			recentRepositoryStore: store,
		});

		expect(manager.getState().recentRepositories).toEqual([]);
		expect(errors.map((error) => error.message)).toEqual(["state unreadable"]);
	});
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonRecentRepositoryStore } from "../src/main/git/recent-repository-store.js";

const roots = new Set<string>();

const createStore = async (): Promise<{
	readonly filePath: string;
	readonly store: JsonRecentRepositoryStore;
}> => {
	const root = await mkdtemp(join(tmpdir(), "1git-recent-store-"));
	roots.add(root);
	const filePath = join(root, "state", "recent-repositories.json");
	return {
		filePath,
		store: new JsonRecentRepositoryStore(filePath),
	};
};

afterEach(async () => {
	await Promise.all(
		[...roots].map(async (root) => {
			await rm(root, { force: true, recursive: true });
		})
	);
	roots.clear();
});

describe("JsonRecentRepositoryStore", () => {
	test("returns an empty list when no persistence file exists", async () => {
		const { store } = await createStore();

		expect(store.load()).toEqual([]);
	});

	test("round-trips a versioned recent repository document", async () => {
		const { filePath, store } = await createStore();
		const repositories = [
			{
				lastOpenedAt: "2026-07-29T18:00:00.000Z",
				path: "/repositories/one",
			},
			{
				lastOpenedAt: "2026-07-28T18:00:00.000Z",
				path: "/repositories/two",
			},
		] as const;

		store.save(repositories);

		expect(store.load()).toEqual(repositories);
		expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
			repositories,
			version: 1,
		});
		if (process.platform !== "win32") {
			expect((await stat(filePath)).mode % 0o1000).toBe(0o600);
		}
	});

	test("persists only paths and timestamps", async () => {
		const { filePath, store } = await createStore();
		const repositoryWithSecrets = {
			lastOpenedAt: "2026-07-29T18:00:00.000Z",
			password: "secret-password",
			path: "/repositories/one",
			remoteUrl: "https://user:secret@example.com/repository.git",
			token: "secret-token",
		};

		store.save([repositoryWithSecrets]);
		const content = await readFile(filePath, "utf8");

		expect(content).not.toContain("secret");
		expect(content).not.toContain("remoteUrl");
		expect(JSON.parse(content)).toEqual({
			repositories: [
				{
					lastOpenedAt: repositoryWithSecrets.lastOpenedAt,
					path: repositoryWithSecrets.path,
				},
			],
			version: 1,
		});
	});

	test("ignores malformed documents and invalid records", async () => {
		const { filePath, store } = await createStore();
		store.save([]);
		await writeFile(filePath, "{broken json");
		expect(store.load()).toEqual([]);

		await writeFile(
			filePath,
			JSON.stringify({
				repositories: [
					{
						lastOpenedAt: "2026-07-29T18:00:00.000Z",
						path: "/repositories/valid",
					},
					{ lastOpenedAt: "not-a-date", path: "/repositories/invalid" },
					{ password: "secret", remoteUrl: "https://example.com" },
				],
				version: 1,
			})
		);

		expect(store.load()).toEqual([
			{
				lastOpenedAt: "2026-07-29T18:00:00.000Z",
				path: "/repositories/valid",
			},
		]);
	});

	test("ignores unsupported document versions", async () => {
		const { filePath, store } = await createStore();
		store.save([]);
		await writeFile(filePath, JSON.stringify({ repositories: [], version: 2 }));

		expect(store.load()).toEqual([]);
	});

	test("rejects an empty persistence path", () => {
		expect(() => new JsonRecentRepositoryStore("")).toThrow(
			"Recent repository file path must not be empty."
		);
	});
});

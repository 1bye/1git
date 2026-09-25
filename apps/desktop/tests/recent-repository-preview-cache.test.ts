import { describe, expect, test } from "bun:test";

import { RecentRepositoryPreviewCache } from "@/fixture/repository-item/lib/recent-repository-preview-cache.js";

import type { RecentRepositoryPreview } from "../src/shared/repository-session.js";

const createPreview = (path: string): RecentRepositoryPreview => ({
	head: {
		ahead: 0,
		behind: 0,
		branch: "main",
		detached: false,
		oid: "abc123",
		unborn: false,
		upstream: null,
	},
	latestCommit: null,
	remotes: [],
	repository: {
		commonDirectory: `${path}/.git`,
		gitDirectory: `${path}/.git`,
		isBare: false,
		isShallow: false,
		root: path,
	},
});

describe("RecentRepositoryPreviewCache", () => {
	test("deduplicates concurrent repository preview requests", async () => {
		const pending = Promise.withResolvers<RecentRepositoryPreview | null>();
		let loadCount = 0;

		const cache = new RecentRepositoryPreviewCache({
			loader: async () => {
				loadCount += 1;

				return await pending.promise;
			},
		});

		const first = cache.load("/repo");
		const second = cache.load("/repo");
		const preview = createPreview("/repo");

		pending.resolve(preview);

		expect(await Promise.all([first, second])).toEqual([preview, preview]);
		expect(loadCount).toBe(1);
		expect(cache.peek("/repo")).toBe(preview);
	});

	test("serves stale data while refreshing an expired preview", async () => {
		let now = 0;
		let loadCount = 0;

		const cache = new RecentRepositoryPreviewCache({
			loader: (path) => {
				loadCount += 1;

				return Promise.resolve(createPreview(`${path}-${loadCount}`));
			},
			now: () => now,
			ttlMs: 10,
		});

		const first = await cache.load("/repo");

		now = 11;
		const stale = cache.peek("/repo");
		const refreshed = await cache.load("/repo");

		expect(stale).toBe(first);
		expect(refreshed?.repository.root).toBe("/repo-2");
		expect(loadCount).toBe(2);
	});

	test("bounds retained repository previews", async () => {
		const cache = new RecentRepositoryPreviewCache({
			loader: (path) => Promise.resolve(createPreview(path)),
			maxEntries: 2,
		});

		await cache.load("/one");
		await cache.load("/two");
		await cache.load("/three");

		expect(cache.peek("/one")).toBeNull();
		expect(cache.peek("/two")).not.toBeNull();
		expect(cache.peek("/three")).not.toBeNull();
	});
});

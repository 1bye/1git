import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	GithubAvatarCache,
	type GithubAvatarFetch,
} from "../src/main/repository-owners/github-avatar-cache.js";

const roots = new Set<string>();
const AVATAR_DATA_URL = "data:image/png;base64,AQID";

const createCacheDirectory = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "1git-avatar-cache-"));

	roots.add(root);

	return join(root, "avatars");
};

const successfulFetch =
	(requests: string[]): GithubAvatarFetch =>
	(url) => {
		requests.push(url);

		if (url.startsWith("https://api.github.com/users/")) {
			return Promise.resolve(
				Response.json({
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				})
			);
		}

		return Promise.resolve(
			new Response(Uint8Array.from([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			})
		);
	};

afterEach(async () => {
	await Promise.all(
		[...roots].map(async (root) => {
			await rm(root, { force: true, recursive: true });
		})
	);
	roots.clear();
});

describe("GithubAvatarCache", () => {
	test("fetches an account avatar and reuses it from memory", async () => {
		const requests: string[] = [];

		const cache = new GithubAvatarCache({
			cacheDirectory: await createCacheDirectory(),
			fetch: successfulFetch(requests),
		});

		expect(await cache.get("OpenAI")).toEqual({
			dataUrl: AVATAR_DATA_URL,
			status: "available",
		});
		expect(await cache.get("openai")).toEqual({
			dataUrl: AVATAR_DATA_URL,
			status: "available",
		});
		expect(requests).toHaveLength(2);
	});

	test("reuses a fresh avatar from disk without another request", async () => {
		const requests: string[] = [];
		const cacheDirectory = await createCacheDirectory();

		const firstCache = new GithubAvatarCache({
			cacheDirectory,
			fetch: successfulFetch(requests),
		});

		await firstCache.get("openai");

		const secondCache = new GithubAvatarCache({
			cacheDirectory,
			fetch: () =>
				Promise.reject(
					new Error("Network should not be used for a fresh cache.")
				),
		});

		expect(await secondCache.get("openai")).toEqual({
			dataUrl: AVATAR_DATA_URL,
			status: "available",
		});
		expect(await readdir(cacheDirectory)).toHaveLength(1);
	});

	test("falls back to a stale disk avatar while offline", async () => {
		const cacheDirectory = await createCacheDirectory();

		const firstCache = new GithubAvatarCache({
			cacheDirectory,
			fetch: successfulFetch([]),
			now: () => 0,
		});

		await firstCache.get("openai");

		const offlineCache = new GithubAvatarCache({
			cacheDirectory,
			fetch: () => Promise.reject(new Error("Offline")),
			now: () => 8 * 24 * 60 * 60 * 1000,
		});

		expect(await offlineCache.get("openai")).toEqual({
			dataUrl: AVATAR_DATA_URL,
			status: "available",
		});
	});

	test("rejects avatar URLs outside GitHub-controlled hosts", async () => {
		let requestCount = 0;

		const fetch: GithubAvatarFetch = () => {
			requestCount += 1;

			return Promise.resolve(
				Response.json({ avatar_url: "https://example.com/avatar.png" })
			);
		};

		const cache = new GithubAvatarCache({
			cacheDirectory: await createCacheDirectory(),
			fetch,
		});

		expect(await cache.get("openai")).toEqual({ status: "unavailable" });
		expect(requestCount).toBe(1);
	});

	test("rejects malformed owner names without making a request", async () => {
		let requestCount = 0;

		const cache = new GithubAvatarCache({
			cacheDirectory: await createCacheDirectory(),
			fetch: () => {
				requestCount += 1;

				return Promise.resolve(new Response());
			},
		});

		expect(await cache.get("../openai")).toEqual({ status: "unavailable" });
		expect(requestCount).toBe(0);
	});

	test("rejects an empty cache directory", () => {
		expect(() => new GithubAvatarCache({ cacheDirectory: "" })).toThrow(
			"GitHub avatar cache directory must not be empty."
		);
	});
});

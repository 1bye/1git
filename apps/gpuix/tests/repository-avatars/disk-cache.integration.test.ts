/**
 * Covers: persistent avatar reuse, stale refresh, damaged files and bounded private storage.
 * Real: avatar service, hosting provider, Sharp decoding and isolated filesystem storage.
 * Doubles: Git remotes and HTTP responses; no live accounts or network.
 * Requires: writable temporary storage.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	mkdtemp,
	readdir,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import sharp from "sharp";
import type { HostingFetch } from "@1git/hosting/contracts";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { RepositoryAvatarCache } from "../../src/feature/repository-workspace/lib/repository-avatar-cache";
import { RepositoryAvatars } from "../../src/feature/repository-workspace/lib/repository-avatars";

let directory: string;
let services: RepositoryAvatars[];

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-avatar-cache-"));
	services = [];
});

afterEach(async () => {
	for (const service of services) service.dispose();

	await rm(directory, { recursive: true, force: true });
});

const image = async (background: string): Promise<Buffer> =>
	await sharp({ create: { width: 64, height: 64, channels: 4, background } })
		.png()
		.toBuffer();

const service = (
	fetch: HostingFetch,
	cache = new RepositoryAvatarCache(directory)
): RepositoryAvatars => {
	const avatars = new RepositoryAvatars(
		async () => [new GitHubProvider({ fetch })],
		async () => [
			{
				name: "origin",
				fetchUrls: ["git@github.com:alice/demo.git"],
				pushUrls: [],
				defaultBranch: null,
			},
		],
		cache
	);

	services.push(avatars);

	return avatars;
};

const cachedPath = async (): Promise<string> => {
	const name = (await readdir(directory)).find((file) => file.endsWith(".png"));

	if (!name) throw new Error("Avatar was not persisted");

	return join(directory, name);
};

it("reuses one owner's private thumbnail in a fresh service without network requests", async () => {
	const png = await image("blue");
	let requests = 0;

	const fetch = async (): Promise<Response> => {
		requests += 1;

		return new Response(png, { headers: { "content-type": "image/png" } });
	};

	const first = service(fetch);
	const original = await first.load({ path: "/test/project" });

	first.dispose();
	const next = service(fetch);

	expect(await next.load({ remote: "https://github.com/alice/another" })).toBe(
		original
	);
	expect(original).toStartWith("data:image/png;base64,");
	expect(requests).toBe(1);
	const path = await cachedPath();

	expect(await readdir(directory)).toEqual([basename(path)]);
	expect(basename(path)).toMatch(/^[a-f0-9]{64}\.png$/u);

	if (process.platform !== "win32") {
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	}
});

it("shows yesterday's thumbnail while refreshing and persists the new image", async () => {
	const oldPng = await image("blue");
	const newPng = await image("red");

	const first = service(
		async () =>
			new Response(oldPng, { headers: { "content-type": "image/png" } })
	);

	const source = { remote: "https://github.com/alice/demo" };
	const original = await first.load(source);
	const path = await cachedPath();
	const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);

	await utimes(path, yesterday, yesterday);
	first.dispose();
	const response = Promise.withResolvers<Response>();
	const next = service(async () => await response.promise);
	const published = Promise.withResolvers<void>();

	const unsubscribe = next.subscribe(RepositoryAvatars.key(source), () =>
		published.resolve()
	);

	const loading = next.load(source);

	try {
		await published.promise;
		expect(next.read(RepositoryAvatars.key(source))).toBe(original);
	} finally {
		response.resolve(
			new Response(newPng, { headers: { "content-type": "image/png" } })
		);
		unsubscribe();
	}

	const refreshed = await loading;

	expect(refreshed).not.toBe(original);
	expect(refreshed).toStartWith("data:image/png;base64,");
	next.dispose();
	const restarted = service(async () => {
		throw new Error("Network must not be used for a fresh cache");
	});

	expect(await restarted.load(source)).toBe(refreshed);
});

it("keeps expired artwork during an outage and retries it on the next restart", async () => {
	const png = await image("blue");

	const first = service(
		async () => new Response(png, { headers: { "content-type": "image/png" } })
	);

	const source = { remote: "https://github.com/alice/demo" };
	const original = await first.load(source);
	const path = await cachedPath();
	const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);

	await utimes(path, yesterday, yesterday);
	first.dispose();
	let attempts = 0;

	const offline = async (): Promise<Response> => {
		attempts += 1;

		throw new Error("Offline");
	};

	const second = service(offline);

	expect(await second.load(source)).toBe(original);
	second.dispose();
	expect(await service(offline).load(source)).toBe(original);
	expect(attempts).toBe(2);
	expect((await stat(path)).mtimeMs).toBeLessThan(
		Date.now() - 24 * 60 * 60 * 1000
	);
});

it("redownloads corrupted or oversized cache files", async () => {
	const png = await image("blue");
	let requests = 0;

	const fetch = async (): Promise<Response> => {
		requests += 1;

		return new Response(png, { headers: { "content-type": "image/png" } });
	};

	const source = { remote: "https://github.com/alice/demo" };
	const original = await service(fetch).load(source);
	const path = await cachedPath();

	for (const bytes of [png.subarray(0, 30), Buffer.alloc(64 * 1024 + 1)]) {
		await writeFile(path, bytes);
		expect(await service(fetch).load(source)).toBe(original);
	}

	expect(requests).toBe(3);
});

it("still displays downloaded avatars when cache storage is unavailable", async () => {
	const blockedPath = join(directory, "blocked");

	await writeFile(blockedPath, "regular file");
	const png = await image("blue");

	const avatars = service(
		async () => new Response(png, { headers: { "content-type": "image/png" } }),
		new RepositoryAvatarCache(blockedPath)
	);

	expect(
		await avatars.load({ remote: "https://github.com/alice/demo" })
	).toStartWith("data:image/png;base64,");
});

it("does not reuse a fresh cached image after avatar metadata changes", async () => {
	const png = await image("blue");
	const requests: string[] = [];

	const fetch = async (url: string | URL | Request): Promise<Response> => {
		requests.push(String(url));

		return new Response(png, { headers: { "content-type": "image/png" } });
	};

	const source = {
		remote: "https://github.com/alice/demo",
		avatarUrl: "https://avatars.githubusercontent.com/u/1?v=1",
	};

	await service(fetch).load(source);
	await service(fetch).load({
		...source,
		avatarUrl: "https://avatars.githubusercontent.com/u/1?v=2",
	});
	expect(requests).toHaveLength(2);
	expect(requests[1]).toContain("v=2");
	expect(await readdir(directory)).toHaveLength(2);
});

it("evicts the oldest thumbnails at 256 entries and leaves unrelated files alone", async () => {
	const cache = new RepositoryAvatarCache(join(directory, "avatars"));
	const src = `data:image/png;base64,${(await image("blue")).toString("base64")}`;

	await cache.write("oldest", src);
	const name = (await readdir(cache.directory))[0];

	if (!name) throw new Error("Avatar was not persisted");

	const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);

	await utimes(join(cache.directory, name), yesterday, yesterday);
	await writeFile(join(cache.directory, "unrelated.txt"), "keep");

	for (let index = 0; index < 256; index += 1)
		await cache.write(`owner-${index}`, src);

	expect(await cache.read("oldest")).toBeNull();
	expect(
		(await readdir(cache.directory)).filter((file) => file.endsWith(".png"))
	).toHaveLength(256);
	expect(await readdir(cache.directory)).toContain("unrelated.txt");

	if (process.platform !== "win32") {
		expect((await stat(cache.directory)).mode & 0o777).toBe(0o700);
	}
});

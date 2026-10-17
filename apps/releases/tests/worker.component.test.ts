/**
 * Covers: public GET/HEAD downloads, latest-release redirects, exact routes, and no writes.
 * Real: Worker handler, streaming responses, HTTP headers.
 * Doubles: R2 read binding; no Cloudflare account, deployment, or uploads.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import worker, { type DownloadEnvironment } from "../src/worker";

it("serves unchanged feed/ZIP bytes with separate cache policies and HEAD metadata", async () => {
	const seen: string[] = [];

	const env: DownloadEnvironment = {
		UPDATES: {
			async head(key) {
				seen.push(`head:${key}`);

				return { size: 4, httpEtag: '"etag"' };
			},
			async get(key) {
				seen.push(`get:${key}`);

				return {
					size: 4,
					httpEtag: '"etag"',
					body: new Blob(["data"]).stream(),
				};
			},
		},
	};

	const feed = await worker.fetch(
		new Request("https://updates.test/appcast.xml"),
		env
	);

	expect(await feed.text()).toBe("data");
	expect(feed.headers.get("cache-control")).toBe("no-store");
	expect(feed.headers.get("content-type")).toStartWith("application/xml");
	const zip = await worker.fetch(
		new Request("https://updates.test/1git-0.0.2-macos-arm64.zip"),
		env
	);

	expect(await zip.text()).toBe("data");
	expect(zip.headers.get("cache-control")).toContain("immutable");
	expect(zip.headers.get("content-disposition")).toContain("attachment");
	const head = await worker.fetch(
		new Request("https://updates.test/appcast.xml", { method: "HEAD" }),
		env
	);

	expect(await head.text()).toBe("");
	expect(head.headers.get("etag")).toBe('"etag"');
	expect(seen).toEqual([
		"get:appcast.xml",
		"get:1git-0.0.2-macos-arm64.zip",
		"head:appcast.xml",
	]);
});

it("rejects writes, arbitrary bucket keys, encoded paths, and directory listing without reading R2", async () => {
	let reads = 0;

	const env: DownloadEnvironment = {
		UPDATES: {
			async get() {
				reads++;

				return null;
			},
			async head() {
				reads++;

				return null;
			},
		},
	};

	for (const method of ["PUT", "POST", "DELETE", "PATCH"]) {
		const response = await worker.fetch(
			new Request("https://updates.test/appcast.xml", { method }),
			env
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, HEAD");
	}

	for (const path of [
		"/",
		"/secret.txt",
		"/folder/appcast.xml",
		"/%61ppcast.xml",
		"/1git-0.0.2-macos-arm64.zip/extra",
	]) {
		expect(
			(await worker.fetch(new Request(`https://updates.test${path}`), env))
				.status
		).toBe(404);
	}

	expect(reads).toBe(0);
});

it("returns missing objects and storage failures without caching the errors", async () => {
	const absent: DownloadEnvironment = {
		UPDATES: {
			async get() {
				return null;
			},
			async head() {
				return null;
			},
		},
	};

	expect(
		(
			await worker.fetch(
				new Request("https://updates.test/appcast.xml"),
				absent
			)
		).status
	).toBe(404);
	const failed: DownloadEnvironment = {
		UPDATES: {
			async get() {
				throw new Error("secret backend detail");
			},
			async head() {
				return null;
			},
		},
	};

	const response = await worker.fetch(
		new Request("https://updates.test/appcast.xml"),
		failed
	);

	expect(response.status).toBe(503);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.text()).not.toContain("secret");
});

it("redirects GET and HEAD to the release in the current feed on the requested domain", async () => {
	let version = "0.0.12";
	const seen: string[] = [];

	const env: DownloadEnvironment = {
		UPDATES: {
			async head() {
				throw new Error("The redirect needs the current feed body.");
			},
			async get(key) {
				seen.push(key);
				const body = new Blob([
					`<rss><channel><item><sparkle:version>${version}</sparkle:version><enclosure url="https://old.test/1git-${version}-macos-arm64.zip" /></item></channel></rss>`,
				]);

				return { size: body.size, httpEtag: '"feed"', body: body.stream() };
			},
		},
	};

	for (const method of ["GET", "HEAD"]) {
		const response = await worker.fetch(
			new Request("https://git.1bye.dev/download", { method }),
			env
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			`https://git.1bye.dev/1git-${version}-macos-arm64.zip`
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.text()).toBe("");
		version = "0.0.13";
	}

	expect(seen).toEqual(["appcast.xml", "appcast.xml"]);
});

it("does not redirect when the feed is absent, oversized, or has an invalid version", async () => {
	for (const fixture of [
		null,
		{ xml: "<sparkle:version>0.0.12</sparkle:version>", size: 1024 * 1024 + 1 },
		{ xml: "<sparkle:version>../../secret</sparkle:version>", size: 100 },
		{ xml: "<rss />", size: 7 },
	]) {
		const response = await worker.fetch(
			new Request("https://git.1bye.dev/download"),
			{
				UPDATES: {
					async head() {
						return null;
					},
					async get() {
						return fixture
							? {
									size: fixture.size,
									httpEtag: '"feed"',
									body: new Blob([fixture.xml]).stream(),
								}
							: null;
					},
				},
			}
		);

		expect(response.status).toBe(fixture ? 503 : 404);
		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
	}
});

/**
 * Covers: authoritative metadata, compressed GET validators, read races, oversized feeds and safe permission errors.
 * Real: direct HTTP storage adapter and bounded response reads.
 * Doubles: object responses; no profiles, network or Cloudflare writes.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { R2ReleaseStorage } from "../../native/release-storage";

it("uses the stored ETag, not a weakened transfer validator, for feed replacement", async () => {
	const storage = new R2ReleaseStorage(async (_key, method, options) => {
		if (method === "HEAD")
			return new Response(null, {
				headers: { ETag: '"stored"', "Content-Length": "4" },
			});

		if (method === "PUT") {
			expect(new Headers(options?.headers).get("if-match")).toBe('"stored"');

			return new Response(null, { status: 200 });
		}

		expect(new Headers(options?.headers).get("if-match")).toBe('"stored"');

		return new Response("feed", { headers: { ETag: 'W/"stored"' } });
	});

	const feed = await storage.readFeed();

	expect(feed?.etag).toBe('"stored"');
	expect(new TextDecoder().decode(feed?.bytes)).toBe("feed");
	await storage.replaceFeed(new Blob(["next"]), feed?.etag ?? null);
});

for (const scenario of [
	"changed",
	"missing",
	"wrong-size",
	"no-body",
	"partial",
] as const) {
	it(`refuses to combine metadata with a ${scenario} object read`, async () => {
		const storage = new R2ReleaseStorage(async (_key, method) => {
			if (method === "HEAD")
				return new Response(null, {
					headers: { ETag: '"stored"', "Content-Length": "4" },
				});

			if (scenario === "missing") return new Response(null, { status: 404 });

			return new Response(
				scenario === "no-body"
					? null
					: scenario === "wrong-size"
						? "other-size"
						: "feed",
				{
					headers: {
						ETag: scenario === "changed" ? 'W/"other"' : 'W/"stored"',
					},
					...(scenario === "partial" ? { status: 206 } : {}),
				}
			);
		});

		await expect(storage.readFeed()).rejects.toThrow();
	});
}

for (const etag of [null, 'W/"weak"', "", "unquoted"]) {
	it(`refuses non-atomic feed replacement for ETag ${JSON.stringify(etag)}`, async () => {
		const storage = new R2ReleaseStorage(
			async () =>
				new Response("feed", {
					headers: etag === null ? {} : { ETag: etag },
				})
		);

		await expect(storage.readFeed()).rejects.toThrow("non-atomic replacement");
	});
}

it("bounds feed reads and accepts a missing feed for the first release", async () => {
	const large = new R2ReleaseStorage(
		async () =>
			new Response(new Uint8Array(1024 * 1024 + 1), {
				headers: { ETag: '"large"', "Content-Length": String(1024 * 1024 + 1) },
			})
	);

	const missing = new R2ReleaseStorage(
		async () => new Response(null, { status: 404 })
	);

	await expect(large.readFeed()).rejects.toThrow("1 MiB limit");
	expect(await missing.readFeed()).toBeNull();
});

it("reports profile permissions without exposing a remote error body", async () => {
	const storage = new R2ReleaseStorage(
		async () => new Response("synthetic-private-detail", { status: 403 })
	);

	await expect(
		storage.createArchive("1git-0.0.2-macos-arm64.zip", new Blob(["zip"]))
	).rejects.toThrow("R2 read/write permissions");
	await expect(storage.readFeed()).rejects.not.toThrow(
		"synthetic-private-detail"
	);
});

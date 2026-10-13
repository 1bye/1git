/**
 * Covers: missing/weak ETags, oversized feeds and safe permission errors.
 * Real: direct HTTP storage adapter and bounded response reads.
 * Doubles: object responses; no profiles, network or Cloudflare writes.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { R2ReleaseStorage } from "../../native/release-storage";

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
				headers: { ETag: '"large"' },
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

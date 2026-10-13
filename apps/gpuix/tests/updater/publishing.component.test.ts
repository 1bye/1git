/**
 * Covers: ZIP-before-feed ordering, public verification, monotonic versions, and failure isolation.
 * Real: publisher orchestration, streamed SHA-256 verification, local artifacts.
 * Doubles: storage and download boundaries; no Cloudflare account or uploads.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	ReleasePublisher,
	type PublishedFeed,
	type ReleaseStorage,
	type ReleaseFetch,
} from "../../native/release-publisher";
import type { PreparedUpdate } from "../../native/prepare-updates";

const feed = (version: string) =>
	`<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><sparkle:version>${version}</sparkle:version></item></channel></rss>`;

for (const scenario of [
	"success",
	"local-feed-race",
	"zip-failure",
	"bad-download",
	"race",
	"older",
	"same",
] as const) {
	it(`keeps the signed feed safe for ${scenario}`, async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "1git-publish-test-"));
		const archivePath = resolve(directory, "archive.zip");
		const feedPath = resolve(directory, "appcast.xml");

		await writeFile(archivePath, "archive bytes");
		await writeFile(feedPath, feed("0.0.2"));
		const artifacts: PreparedUpdate = {
			version: "0.0.2",
			archivePath,
			feedPath,
			feedURL: "https://updates.test/appcast.xml",
			publicKey: "test",
		};

		const events: string[] = [];
		let uploadedFeed = "";

		const old: PublishedFeed = {
			bytes: new TextEncoder().encode(
				feed(
					scenario === "older"
						? "0.0.10"
						: scenario === "same"
							? "0.0.2"
							: "0.0.1"
				)
			),
			etag: '"original"',
		};

		const storage: ReleaseStorage = {
			async readFeed() {
				events.push("read-feed");

				return old;
			},
			async createArchive(key) {
				events.push(`zip:${key}`);

				if (scenario === "local-feed-race")
					await writeFile(feedPath, feed("0.0.3"));

				if (scenario === "zip-failure") throw new Error("upload failed");
			},
			async replaceFeed(body, etag) {
				events.push(`feed:${etag}`);
				uploadedFeed = await body.text();

				if (scenario === "race") throw new Error("changed the feed");
			},
		};

		const download: ReleaseFetch = async (input) => {
			const name = new URL(String(input)).pathname.slice(1);

			events.push(`verify:${name}`);

			return new Response(
				name === "appcast.xml"
					? uploadedFeed
					: scenario === "bad-download"
						? "tampered bytes"
						: "archive bytes"
			);
		};

		try {
			const publisher = new ReleasePublisher(storage, download);

			if (scenario === "success" || scenario === "local-feed-race") {
				await publisher.publish(artifacts);
				expect(events).toEqual([
					"read-feed",
					"zip:1git-0.0.2-macos-arm64.zip",
					"verify:1git-0.0.2-macos-arm64.zip",
					'feed:"original"',
					"verify:appcast.xml",
				]);
				expect(uploadedFeed).toBe(feed("0.0.2"));
			} else {
				await expect(publisher.publish(artifacts)).rejects.toThrow();

				if (scenario !== "race")
					expect(events.some((event) => event.startsWith("feed:"))).toBe(false);

				if (scenario === "older" || scenario === "same")
					expect(events).toEqual(["read-feed"]);

				if (scenario === "race") expect(events.at(-1)).toBe('feed:"original"');
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

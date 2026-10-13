/**
 * Covers: signed HTTP requests, immutable ZIP conditions, feed CAS, and byte verification.
 * Real: Bun S3 presigner, HTTP transport and publisher against a loopback server.
 * Doubles: R2 conditional semantics/public endpoint; no Cloudflare account or real uploads.
 * Requires: local network access only; no credentials.
 */
import { expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { R2ReleaseStorage } from "../../native/release-storage";
import { ReleasePublisher } from "../../native/release-publisher";

it("uses signed conditional uploads and advances the feed only after checking ZIP bytes", async () => {
	const objects = new Map<string, Uint8Array>();
	const events: string[] = [];

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const key = url.pathname.split("/").at(-1) ?? "";
			const signed = url.searchParams.has("X-Amz-Signature");

			events.push(`${request.method}:${signed ? "signed" : "public"}:${key}`);

			if (request.method === "PUT") {
				expect(signed).toBe(true);

				if (request.headers.get("if-none-match") === "*" && objects.has(key))
					return new Response(null, { status: 412 });

				if (
					request.headers.has("if-match") &&
					request.headers.get("if-match") !== '"etag"'
				)
					return new Response(null, { status: 412 });

				expect(request.headers.get("cache-control")).toBe(
					key === "appcast.xml"
						? "no-store"
						: "public, max-age=31536000, immutable"
				);
				objects.set(key, new Uint8Array(await request.arrayBuffer()));

				return new Response(null, { headers: { ETag: '"etag"' } });
			}

			const data = objects.get(key);

			return data
				? new Response(data, { headers: { ETag: '"etag"' } })
				: new Response(null, { status: 404 });
		},
	});

	const directory = await mkdtemp(resolve(tmpdir(), "1git-r2-transport-"));
	const archivePath = resolve(directory, "update.zip");
	const feedPath = resolve(directory, "appcast.xml");

	const storage = R2ReleaseStorage.from({
		endpoint: String(server.url),
		bucket: "test-updates",
		accessKeyId: "synthetic-access",
		secretAccessKey: "synthetic-secret",
	});

	try {
		await writeFile(archivePath, "zip bytes");
		const xml = `<rss xmlns:s="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><s:version>0.0.2</s:version></item></channel></rss>`;

		await writeFile(feedPath, xml);
		await new ReleasePublisher(storage).publish({
			version: "0.0.2",
			archivePath,
			feedPath,
			feedURL: new URL("/appcast.xml", server.url).href,
			publicKey: "test",
		});
		expect(events).toEqual([
			"GET:signed:appcast.xml",
			"PUT:signed:1git-0.0.2-macos-arm64.zip",
			"GET:public:1git-0.0.2-macos-arm64.zip",
			"PUT:signed:appcast.xml",
			"GET:public:appcast.xml",
		]);
		expect((await storage.readFeed())?.etag).toBe('"etag"');
		await expect(
			storage.createArchive(
				"1git-0.0.2-macos-arm64.zip",
				new Blob(["different"])
			)
		).rejects.toThrow("already exists");
		await expect(
			storage.replaceFeed(new Blob([xml]), '"changed"')
		).rejects.toThrow("Another release");
		expect(
			new TextDecoder().decode(objects.get("1git-0.0.2-macos-arm64.zip"))
		).toBe("zip bytes");
	} finally {
		server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
});

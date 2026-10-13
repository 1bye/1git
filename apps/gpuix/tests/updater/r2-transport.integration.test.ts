/**
 * Covers: conditional HTTP uploads, duplicate ZIPs, simultaneous publishers and fail-closed preflight.
 * Real: Bun HTTP transport, storage adapter, publisher and local artifact verification.
 * Doubles: profile authentication and R2/public server semantics; no Cloudflare account or real uploads.
 * Requires: loopback network access only; no credentials.
 */
import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { R2ReleaseStorage } from "../../native/release-storage";
import { ReleaseFeed, ReleasePublisher } from "../../native/release-publisher";
import type { PreparedUpdate } from "../../native/prepare-updates";
import type { ReleaseObjectRequest } from "@1git/releases/publishing";

it("preserves immutable ZIPs and lets only one simultaneous publisher replace the feed", async () => {
	const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
	const events: string[] = [];
	let ignoredCondition: "none" | "create" | "replace" = "none";
	let race = false;
	let raceReads = 0;
	const barrier = Promise.withResolvers<void>();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const authenticated = url.pathname.startsWith("/objects/");
			const key = url.pathname.slice(authenticated ? "/objects/".length : 1);

			events.push(
				`${request.method}:${authenticated ? "profile" : "public"}:${key}`
			);

			if (authenticated)
				expect(request.headers.get("authorization")).toBe(
					"Bearer synthetic-profile"
				);

			if (request.method === "PUT") {
				expect(authenticated).toBe(true);
				const bytes = new Uint8Array(await request.arrayBuffer());
				const previous = objects.get(key);

				if (
					ignoredCondition !== "create" &&
					request.headers.get("if-none-match") === "*" &&
					previous
				)
					return new Response(null, { status: 412 });

				if (
					ignoredCondition !== "replace" &&
					request.headers.has("if-match") &&
					request.headers.get("if-match") !== previous?.etag
				)
					return new Response(null, { status: 412 });

				if (!key.startsWith("release-checks/"))
					expect(request.headers.get("cache-control")).toBe(
						key === "appcast.xml"
							? "no-store"
							: "public, max-age=31536000, immutable"
					);

				const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;

				objects.set(key, { bytes, etag });

				return Response.json({ success: true, result: { etag } });
			}

			if (request.method === "DELETE") {
				expect(authenticated).toBe(true);
				expect(key).toStartWith("release-checks/");
				objects.delete(key);

				return Response.json({ success: true });
			}

			const data = objects.get(key);

			if (race && authenticated && key === "appcast.xml") {
				raceReads += 1;

				if (raceReads === 2) barrier.resolve();

				await barrier.promise;
			}

			return data
				? new Response(data.bytes, { headers: { ETag: data.etag } })
				: new Response(null, { status: 404 });
		},
	});

	const directory = await mkdtemp(resolve(tmpdir(), "1git-r2-transport-"));

	const request: ReleaseObjectRequest = async (key, method, options = {}) => {
		const headers = new Headers(options.headers);

		headers.set("authorization", "Bearer synthetic-profile");

		return await fetch(new URL(`/objects/${key}`, server.url), {
			...options,
			method,
			headers,
		});
	};

	const storage = new R2ReleaseStorage(request);

	const prepare = async (version: string): Promise<PreparedUpdate> => {
		const archivePath = resolve(directory, `${version}.zip`);
		const feedPath = resolve(directory, `${version}.xml`);

		await writeFile(archivePath, `zip ${version}`);
		await writeFile(
			feedPath,
			`<rss xmlns:s="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><s:version>${version}</s:version></item></channel></rss>`
		);

		return {
			version,
			archivePath,
			feedPath,
			feedURL: new URL("/appcast.xml", server.url).href,
			publicKey: "test",
		};
	};

	try {
		await new ReleasePublisher(storage).publish(await prepare("0.0.2"));
		const releaseEvents = events.filter(
			(event) => !event.includes("release-checks/")
		);

		expect(releaseEvents).toEqual([
			"GET:profile:appcast.xml",
			"PUT:profile:1git-0.0.2-macos-arm64.zip",
			"GET:public:1git-0.0.2-macos-arm64.zip",
			"PUT:profile:appcast.xml",
			"GET:public:appcast.xml",
		]);
		expect(
			[...objects.keys()].some((key) => key.startsWith("release-checks/"))
		).toBe(false);
		await expect(
			storage.createArchive(
				"1git-0.0.2-macos-arm64.zip",
				new Blob(["different"])
			)
		).rejects.toThrow("already exists");
		await expect(
			storage.replaceFeed(new Blob(["different"]), '"changed"')
		).rejects.toThrow("Another release");
		expect(
			new TextDecoder().decode(objects.get("1git-0.0.2-macos-arm64.zip")?.bytes)
		).toBe("zip 0.0.2");
		await expect(
			new ReleasePublisher(storage).publish(await prepare("0.0.2"))
		).rejects.toThrow("must be newer");

		const competitors = await Promise.all([prepare("0.0.3"), prepare("0.0.4")]);

		race = true;
		const results = await Promise.allSettled(
			competitors.map(
				async (artifacts) =>
					await new ReleasePublisher(new R2ReleaseStorage(request)).publish(
						artifacts
					)
			)
		);

		expect(raceReads).toBe(2);
		expect(
			results.filter((result) => result.status === "fulfilled")
		).toHaveLength(1);
		const loser = results.find((result) => result.status === "rejected");

		expect(loser?.status === "rejected" && String(loser.reason)).toContain(
			"Another release"
		);
		const winner = results.findIndex((result) => result.status === "fulfilled");

		expect(
			ReleaseFeed.latest(
				new TextDecoder().decode(objects.get("appcast.xml")?.bytes)
			)
		).toBe(competitors[winner]?.version);
		expect(objects.has("1git-0.0.3-macos-arm64.zip")).toBe(true);
		expect(objects.has("1git-0.0.4-macos-arm64.zip")).toBe(true);

		race = false;

		for (const condition of ["create", "replace"] as const) {
			ignoredCondition = condition;
			const before = new Map(objects);
			const offset = events.length;

			await expect(
				new ReleasePublisher(storage).publish(await prepare("0.0.5"))
			).rejects.toThrow("conditional writes are not enforced");
			expect(objects).toEqual(before);
			expect(
				events
					.slice(offset)
					.some(
						(event) =>
							event.startsWith("PUT:") && !event.includes("release-checks/")
					)
			).toBe(false);
		}
	} finally {
		server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
}, 15000);

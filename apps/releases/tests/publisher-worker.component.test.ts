/**
 * Covers: signed request scope, digest validation, immutable ZIPs, feed CAS and probe-only deletion.
 * Real: WebCrypto Ed25519 verification, manifest validation and publisher handler.
 * Doubles: native R2 binding with atomic conditional semantics; no Cloudflare writes.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import handler, { type PublisherBucket } from "../src/publisher-worker";
import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	UPLOAD_DOMAIN,
	UPLOAD_LIFETIME_MS,
	type UploadManifest,
} from "../src/upload-protocol";

const setup = () => {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
	const writes: string[] = [];

	const bucket: PublisherBucket = {
		async put(key, body, options) {
			const bytes = new Uint8Array(await new Response(body).arrayBuffer());

			if (createHash("sha256").update(bytes).digest("hex") !== options.sha256)
				throw new Error("Checksum mismatch");

			const current = objects.get(key);

			if (
				"etagMatches" in options.onlyIf &&
				options.onlyIf.etagMatches !== current?.etag
			)
				return null;

			if ("etagDoesNotMatch" in options.onlyIf && current) return null;

			const etag = createHash("md5").update(bytes).digest("hex");

			objects.set(key, { bytes, etag });
			writes.push(key);

			return { httpEtag: `"${etag}"` };
		},
		async delete(key) {
			objects.delete(key);
			writes.push(`delete:${key}`);
		},
	};

	const env = {
		UPDATES: bucket,
		PUBLIC_KEY: publicKey
			.export({ format: "der", type: "spki" })
			.subarray(-32)
			.toString("base64"),
	};

	const request = (
		key: string,
		body = "bytes",
		overrides: Partial<UploadManifest> = {}
	): Request => {
		const manifest: UploadManifest = {
			domain: UPLOAD_DOMAIN,
			origin: "https://publisher.example.com",
			key,
			method: "PUT",
			sha256: createHash("sha256").update(body).digest("hex"),
			size: Buffer.byteLength(body),
			expiresAt: Date.now() + UPLOAD_LIFETIME_MS,
			ifMatch: null,
			ifNoneMatch: "*",
			...overrides,
		};

		const bytes = Buffer.from(JSON.stringify(manifest));

		return new Request(`https://publisher.example.com/${key}`, {
			method: manifest.method,
			body: manifest.method === "DELETE" ? undefined : body,
			headers: {
				[MANIFEST_HEADER]: bytes.toString("base64"),
				[SIGNATURE_HEADER]: sign(null, bytes, privateKey).toString("base64"),
				"Content-Length": String(Buffer.byteLength(body)),
			},
		});
	};

	return { env, objects, writes, request };
};

it("refuses duplicate ZIPs and permits only one simultaneous replacement of a feed", async () => {
	const { env, objects, request } = setup();
	const archive = "1git-0.0.2-macos-arm64.zip";

	expect((await handler.fetch(request(archive), env)).status).toBe(200);
	expect((await handler.fetch(request(archive, "other"), env)).status).toBe(
		412
	);
	expect(new TextDecoder().decode(objects.get(archive)?.bytes)).toBe("bytes");
	const initial = await handler.fetch(request("appcast.xml", "old feed"), env);
	const condition = { ifMatch: initial.headers.get("etag"), ifNoneMatch: null };

	const results = await Promise.all([
		handler.fetch(request("appcast.xml", "feed three", condition), env),
		handler.fetch(request("appcast.xml", "feed four", condition), env),
	]);

	expect(results.map((result) => result.status).sort()).toEqual([200, 412]);
	expect(
		(await handler.fetch(request("appcast.xml", "replay", condition), env))
			.status
	).toBe(412);
});

for (const scenario of [
	"expired",
	"wrong-origin",
	"wrong-key",
	"wrong-method",
	"unconditional",
	"archive-replace",
	"delete-release",
	"encoded-key",
] as const) {
	it(`rejects ${scenario} authorizations before any bucket write`, async () => {
		const { env, writes, request } = setup();
		const archive = "1git-0.0.2-macos-arm64.zip";
		let overrides: Partial<UploadManifest> = {};

		if (scenario === "expired") overrides = { expiresAt: Date.now() - 1 };

		if (scenario === "wrong-origin")
			overrides = { origin: "https://other.example.com" };

		if (scenario === "wrong-key") overrides = { key: "appcast.xml" };

		if (scenario === "unconditional") overrides = { ifNoneMatch: null };

		if (scenario === "archive-replace")
			overrides = { ifNoneMatch: null, ifMatch: '"old"' };

		if (scenario === "delete-release")
			overrides = { method: "DELETE", size: 0, ifNoneMatch: null };

		let input = request(
			scenario === "encoded-key" ? "nested%2fkey" : archive,
			"bytes",
			overrides
		);

		if (scenario === "wrong-method")
			input = new Request(input, { method: "POST" });

		expect((await handler.fetch(input, env)).status).toBe(
			scenario === "wrong-method" ? 405 : 401
		);
		expect(writes).toEqual([]);
	});
}

it("rejects missing/tampered signatures, wrong length and a body checksum mismatch", async () => {
	const { env, objects, request } = setup();
	const key = "1git-0.0.2-macos-arm64.zip";
	const missing = request(key);

	missing.headers.delete(SIGNATURE_HEADER);
	expect((await handler.fetch(missing, env)).status).toBe(401);
	const changed = request(key);

	changed.headers.set(
		MANIFEST_HEADER,
		Buffer.from('{"domain":"tampered"}').toString("base64")
	);
	expect((await handler.fetch(changed, env)).status).toBe(401);
	const wrongLength = request(key);

	wrongLength.headers.set("Content-Length", "1");
	expect((await handler.fetch(wrongLength, env)).status).toBe(400);
	const mismatchedBody = new Request(request(key), {
		method: "PUT",
		body: "other",
	});

	expect((await handler.fetch(mismatchedBody, env)).status).toBe(503);
	expect(objects.size).toBe(0);
});

it("allows cleanup of an authenticated probe but never exposes reads or listing", async () => {
	const { env, objects, request } = setup();
	const key = "release-checks/00000000-0000-4000-8000-000000000000.txt";

	expect((await handler.fetch(request(key), env)).status).toBe(200);
	expect(
		(
			await handler.fetch(
				request(key, "", { method: "DELETE", ifNoneMatch: null }),
				env
			)
		).status
	).toBe(204);
	expect(objects.size).toBe(0);
	expect(
		(await handler.fetch(new Request("https://publisher.example.com/"), env))
			.status
	).toBe(405);
});

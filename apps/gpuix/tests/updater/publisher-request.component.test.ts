/**
 * Covers: checksum/condition-bound signed uploads and client-side scope validation.
 * Real: native request builder, Node Ed25519 and shared manifest parser.
 * Doubles: signing callback and HTTP; no Keychain or Cloudflare calls.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { SignedPublisherRequests } from "../../native/publisher-request";
import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	ReleaseUploadManifest,
	MAX_UPLOAD_BYTES,
	MAX_ARCHIVE_BYTES,
	UPLOAD_PART_BYTES,
} from "@1git/releases/upload-protocol";

it("signs the exact object, body hash and overwrite condition without sending profile credentials", async () => {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	let count = 0;

	const client = new SignedPublisherRequests(
		"https://publisher.example.com",
		async (bytes) => sign(null, bytes, privateKey).toString("base64"),
		async (input, options) => {
			const request = new Request(String(input), options);

			const bytes = Buffer.from(
				request.headers.get(MANIFEST_HEADER) ?? "",
				"base64"
			);

			expect(
				verify(
					null,
					bytes,
					publicKey,
					Buffer.from(request.headers.get(SIGNATURE_HEADER) ?? "", "base64")
				)
			).toBe(true);
			const manifest = ReleaseUploadManifest.parse(
				JSON.parse(bytes.toString("utf8")),
				request
			);

			expect(manifest.key).toBe("appcast.xml");
			expect(manifest.ifMatch).toBe('"previous"');
			expect(manifest.sha256).toBe(
				createHash("sha256").update("signed feed").digest("hex")
			);
			expect(await request.text()).toBe("signed feed");
			expect(request.headers.has("authorization")).toBe(false);
			expect(request.redirect).toBe("error");
			count += 1;

			return new Response(null, { status: 200 });
		}
	);

	await client.send("appcast.xml", "PUT", {
		body: new Blob(["signed feed"]),
		headers: { "If-Match": '"previous"' },
	});

	for (const method of ["GET", "HEAD"] as const)
		await expect(client.send("appcast.xml", method)).rejects.toThrow(
			"Publisher writes only"
		);

	await expect(client.send("appcast.xml", "DELETE")).rejects.toThrow(
		"Only test objects"
	);
	await expect(
		client.send("1git-0.0.2-macos-arm64.zip", "PUT", {
			body: new Blob(["zip"]),
			headers: { "If-Match": '"old"' },
		})
	).rejects.toThrow("immutable");
	expect(count).toBe(1);
});

it("uploads large archives as bounded signed parts and cleans them up on success or failure", async () => {
	const archive = "1git-0.0.11-macos-arm64.zip";
	const body = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)]);

	for (const fail of [false, true]) {
		const sent: ReturnType<typeof ReleaseUploadManifest.parse>[] = [];

		const client = new SignedPublisherRequests(
			"https://publisher.example.com",
			async () => "signature",
			async (input, options) => {
				const request = new Request(String(input), options);

				const manifest = ReleaseUploadManifest.parse(
					JSON.parse(
						Buffer.from(
							request.headers.get(MANIFEST_HEADER) ?? "",
							"base64"
						).toString()
					),
					request
				);

				sent.push(manifest);
				expect(
					Number(request.headers.get("content-length"))
				).toBeLessThanOrEqual(UPLOAD_PART_BYTES);

				if (manifest.parts) {
					expect(manifest.size).toBe(body.size);
					expect(manifest.parts.count).toBe(2);
					expect(request.body).toBeNull();
				}

				return new Response(null, {
					status:
						fail && manifest.key.endsWith("/1.bin") && manifest.method === "PUT"
							? 503
							: 200,
				});
			}
		);

		const upload = client.send(archive, "PUT", {
			body,
			headers: { "If-None-Match": "*" },
		});

		if (fail) await expect(upload).rejects.toThrow("Publisher request failed");
		else expect((await upload).status).toBe(200);

		expect(
			sent.filter((manifest) => manifest.method === "DELETE")
		).toHaveLength(2);
		expect(sent.some((manifest) => manifest.key === archive)).toBe(!fail);
	}

	const url = new Request(`https://publisher.example.com/${archive}`, {
		method: "PUT",
	});

	const base = {
		domain: "1git-release-upload-v1",
		origin: new URL(url.url).origin,
		key: archive,
		method: "PUT",
		sha256: "0".repeat(64),
		size: MAX_ARCHIVE_BYTES + 1,
		expiresAt: Date.now() + 1000,
		ifMatch: null,
		ifNoneMatch: "*",
		parts: { id: "00000000-0000-4000-8000-000000000000", count: 9 },
	};

	expect(() => ReleaseUploadManifest.parse(base, url)).toThrow();
	expect(() =>
		ReleaseUploadManifest.parse(
			{
				...base,
				size: MAX_UPLOAD_BYTES + 1,
				parts: { ...base.parts, count: 1 },
			},
			url
		)
	).toThrow("parts");
}, 15000);

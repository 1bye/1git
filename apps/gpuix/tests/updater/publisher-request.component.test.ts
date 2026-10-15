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

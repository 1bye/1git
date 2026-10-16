import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { Blob } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	UPLOAD_DOMAIN,
	UPLOAD_LIFETIME_MS,
	MAX_UPLOAD_BYTES,
	UPLOAD_PART_BYTES,
	ReleaseUploadManifest,
	type UploadManifest,
} from "@1git/releases/upload-protocol";
import type { ReleaseFetch } from "./release-publisher";
import { sparkleDirectory, sparkleSigningAccount } from "./sparkle";

/** Signs domain-separated upload manifests with the existing update key, without exporting it. */
export class SparkleUploadSigner {
	constructor(
		private readonly publicKey: string,
		private readonly keyFile?: string
	) {}

	async sign(bytes: Uint8Array): Promise<string> {
		const directory = await mkdtemp(resolve(tmpdir(), "1git-upload-signing-"));
		const path = resolve(directory, "manifest.json");

		try {
			await writeFile(path, bytes, { mode: 0o600 });
			const child = Bun.spawn(
				[
					resolve(sparkleDirectory, "bin/sign_update"),
					...(this.keyFile
						? ["--ed-key-file", this.keyFile]
						: ["--account", sparkleSigningAccount]),
					"-p",
					path,
				],
				{ stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30000 }
			);

			const [output, , code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);

			const signature = output.trim();

			const key = createPublicKey({
				key: Buffer.concat([
					Buffer.from("302a300506032b6570032100", "hex"),
					Buffer.from(this.publicKey, "base64"),
				]),
				format: "der",
				type: "spki",
			});

			if (
				code !== 0 ||
				!verify(null, bytes, key, Buffer.from(signature, "base64"))
			)
				throw new Error(
					"Could not sign upload authorization with the existing Sparkle key."
				);

			return signature;
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}

/** Sends scoped, expiring authorizations; the Worker atomically validates each body and condition. */
export class SignedPublisherRequests {
	constructor(
		private readonly origin: string,
		private readonly sign: (bytes: Uint8Array) => Promise<string>,
		private readonly request: ReleaseFetch = fetch
	) {}

	async send(
		key: string,
		method: "GET" | "HEAD" | "PUT" | "DELETE",
		options: Pick<RequestInit, "body" | "headers"> = {}
	): Promise<Response> {
		if (method === "GET" || method === "HEAD")
			throw new Error(
				"Publisher writes only; use profile-authenticated reads."
			);

		const body = method === "DELETE" ? new Blob([]) : options.body;

		if (!(body instanceof Blob))
			throw new Error("Publisher uploads require a Blob.");

		const digest = createHash("sha256");

		for await (const bytes of body.stream()) digest.update(bytes);

		const headers = new Headers(options.headers);
		const url = new URL(`/${key}`, this.origin);

		const parts =
			method === "PUT" && body.size > MAX_UPLOAD_BYTES
				? { id: randomUUID(), count: Math.ceil(body.size / UPLOAD_PART_BYTES) }
				: undefined;

		const manifest: UploadManifest = {
			domain: UPLOAD_DOMAIN,
			origin: url.origin,
			key,
			method,
			sha256: digest.digest("hex"),
			size: body.size,
			expiresAt: Date.now() + UPLOAD_LIFETIME_MS,
			ifMatch: headers.get("if-match"),
			ifNoneMatch: headers.get("if-none-match"),
			...(parts ? { parts } : {}),
		};

		ReleaseUploadManifest.parse(manifest, new Request(url.href, { method }));
		const bytes = new TextEncoder().encode(JSON.stringify(manifest));

		headers.set(MANIFEST_HEADER, Buffer.from(bytes).toString("base64"));
		headers.set(SIGNATURE_HEADER, await this.sign(bytes));
		headers.set("Content-Length", String(parts ? 0 : body.size));
		const uploaded: string[] = [];

		try {
			if (parts) {
				for (let index = 0; index < parts.count; index++) {
					const part = `release-parts/${parts.id}/${index}.bin`;

					uploaded.push(part);
					const response = await this.send(part, "PUT", {
						body: body.slice(
							index * UPLOAD_PART_BYTES,
							(index + 1) * UPLOAD_PART_BYTES
						),
						headers: { "If-None-Match": "*" },
					});

					if (!response.ok)
						throw new Error(`Archive part upload failed (${response.status}).`);
				}

				// The authorization must remain fresh even on slower connections.
				manifest.expiresAt = Date.now() + UPLOAD_LIFETIME_MS;
				const fresh = new TextEncoder().encode(JSON.stringify(manifest));

				headers.set(MANIFEST_HEADER, Buffer.from(fresh).toString("base64"));
				headers.set(SIGNATURE_HEADER, await this.sign(fresh));
			}

			return await this.request(url, {
				method,
				headers,
				body: method === "DELETE" || parts ? undefined : body,
				redirect: "error",
				signal: AbortSignal.timeout(120000),
			});
		} catch {
			throw new Error(
				"Publisher request failed; inspect release state before retrying."
			);
		} finally {
			for (const part of uploaded) {
				let cleaned = false;

				try {
					const response = await this.send(part, "DELETE");

					cleaned = response.ok || response.status === 404;
				} catch {
					// Report cleanup failures without hiding the publication result.
				}

				if (!cleaned) {
					process.stderr.write(
						`Warning: could not remove temporary release part ${part}.\n`
					);
				}
			}
		}
	}
}

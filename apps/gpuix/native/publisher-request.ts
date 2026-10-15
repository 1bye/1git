import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	UPLOAD_DOMAIN,
	UPLOAD_LIFETIME_MS,
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
		};

		ReleaseUploadManifest.parse(manifest, new Request(url.href, { method }));
		const bytes = new TextEncoder().encode(JSON.stringify(manifest));

		headers.set(MANIFEST_HEADER, Buffer.from(bytes).toString("base64"));
		headers.set(SIGNATURE_HEADER, await this.sign(bytes));
		headers.set("Content-Length", String(body.size));

		try {
			return await this.request(url, {
				method,
				headers,
				body: method === "DELETE" ? undefined : body,
				redirect: "error",
				signal: AbortSignal.timeout(120000),
			});
		} catch {
			throw new Error(
				"Publisher request failed; inspect release state before retrying."
			);
		}
	}
}

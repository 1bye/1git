import { randomUUID } from "node:crypto";
import type { ReleaseObjectRequest } from "@1git/releases/publishing";
import type { PublishedFeed, ReleaseStorage } from "./release-publisher";

/** Sends guarded R2 HTTP writes through the existing Alchemy profile. */
export class R2ReleaseStorage implements ReleaseStorage {
	constructor(private readonly request: ReleaseObjectRequest) {}

	async verifyConditionalWrites(): Promise<void> {
		const key = `release-checks/${randomUUID()}.txt`;
		const original = new Blob(["original"]);
		const changed = new Blob(["changed"]);

		const create = await this.request(key, "PUT", {
			body: original,
			headers: { "If-None-Match": "*", "Content-Type": "text/plain" },
		});

		if (!create.ok)
			throw this.responseError(create, "Could not check R2 conditional writes");

		try {
			const before = await this.readObject(key);

			if (!before || new TextDecoder().decode(before.bytes) !== "original")
				throw new Error(
					"R2 conditional-write check could not read its test object."
				);

			await this.expectPreconditionFailure(key, changed, {
				"If-None-Match": "*",
			});
			await this.expectPreconditionFailure(key, changed, {
				"If-Match": '"not-the-current-etag"',
			});

			const replace = await this.request(key, "PUT", {
				body: changed,
				headers: { "If-Match": before.etag, "Content-Type": "text/plain" },
			});

			if (!replace.ok)
				throw this.responseError(
					replace,
					"Could not check R2 ETag replacement"
				);

			await this.expectPreconditionFailure(key, original, {
				"If-Match": before.etag,
			});
			const after = await this.readObject(key);

			if (
				!after ||
				after.etag === before.etag ||
				new TextDecoder().decode(after.bytes) !== "changed"
			)
				throw new Error(
					"R2 conditional writes did not preserve the expected bytes. Refusing to publish."
				);
		} finally {
			await this.cleanupProbe(key);
		}
	}

	private async cleanupProbe(key: string): Promise<void> {
		try {
			const cleanup = await this.request(key, "DELETE");

			if (!cleanup.ok && cleanup.status !== 404)
				throw new Error("Could not remove test object.");
		} catch {
			process.stderr.write(
				`Warning: could not remove R2 test object ${key}.\n`
			);
		}
	}

	async readFeed(): Promise<PublishedFeed | null> {
		return await this.readObject("appcast.xml");
	}

	private async readObject(key: string): Promise<PublishedFeed | null> {
		const response = await this.request(key, "GET");

		if (response.status === 404) return null;

		if (!response.ok)
			throw this.responseError(response, "Could not read the published object");

		const etag = response.headers.get("etag");

		if (!etag || !/^"[^"\r\n]+"$/u.test(etag) || !response.body)
			throw new Error(
				"Published object has no ETag/body; refusing a non-atomic replacement."
			);

		const chunks: Uint8Array[] = [];
		let size = 0;

		for await (const chunk of response.body) {
			size += chunk.byteLength;

			if (size > 1024 * 1024)
				throw new Error("Published feed exceeds the 1 MiB limit.");

			chunks.push(chunk);
		}

		return { bytes: Buffer.concat(chunks), etag };
	}

	async createArchive(key: string, body: Blob): Promise<void> {
		const response = await this.request(key, "PUT", {
			body,
			headers: {
				"If-None-Match": "*",
				"Content-Type": "application/zip",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});

		if (response.status === 412)
			throw new Error(
				"That versioned ZIP already exists; immutable releases cannot be overwritten."
			);

		if (!response.ok)
			throw this.responseError(
				response,
				"ZIP upload failed. Feed not advanced"
			);
	}

	async replaceFeed(body: Blob, previousEtag: string | null): Promise<void> {
		const response = await this.request("appcast.xml", "PUT", {
			body,
			headers: {
				...(previousEtag
					? { "If-Match": previousEtag }
					: { "If-None-Match": "*" }),
				"Content-Type": "application/xml",
				"Cache-Control": "no-store",
			},
		});

		if (response.status === 412)
			throw new Error(
				"Another release changed the feed. Refusing to overwrite it; uploaded ZIP remains available."
			);

		if (!response.ok)
			throw this.responseError(
				response,
				"Feed upload failed. Uploaded ZIP remains available"
			);
	}

	private async expectPreconditionFailure(
		key: string,
		body: Blob,
		headers: Record<string, string>
	): Promise<void> {
		const response = await this.request(key, "PUT", {
			body,
			headers: { "Content-Type": "text/plain", ...headers },
		});

		if (response.status !== 412)
			throw new Error(
				`R2 HTTP conditional writes are not enforced (HTTP ${response.status}). Refusing to publish without duplicate/concurrent-release protection.`
			);
	}

	private responseError(response: Response, operation: string): Error {
		const hint =
			response.status === 401 || response.status === 403
				? " Check R2 read/write permissions in your existing Alchemy profile."
				: "";

		return new Error(`${operation} (${response.status}).${hint}`);
	}
}

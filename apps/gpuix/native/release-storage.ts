import { S3Client } from "bun";
import type { ReleaseUploadCredentials } from "@1git/releases/publishing";
import type {
	PublishedFeed,
	ReleaseStorage,
	ReleaseFetch,
} from "./release-publisher";

/** Sends conditional R2 S3 writes using Bun's native SigV4 presigner. */
export class R2ReleaseStorage implements ReleaseStorage {
	constructor(
		private readonly client: S3Client,
		private readonly request: ReleaseFetch = fetch
	) {}

	static from(credentials: ReleaseUploadCredentials): R2ReleaseStorage {
		return new R2ReleaseStorage(
			new S3Client({
				endpoint: credentials.endpoint,
				bucket: credentials.bucket,
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
				region: "auto",
			})
		);
	}

	async readFeed(): Promise<PublishedFeed | null> {
		const response = await this.send("appcast.xml", "GET");

		if (response.status === 404) return null;

		if (!response.ok)
			throw new Error(
				`Could not read the published feed (${response.status}).`
			);

		const etag = response.headers.get("etag");

		if (!etag || !response.body)
			throw new Error(
				"Published feed has no ETag/body; refusing a non-atomic replacement."
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
		const response = await this.send(key, "PUT", {
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
			throw new Error(
				`ZIP upload failed (${response.status}). Feed not advanced.`
			);
	}

	async replaceFeed(body: Blob, previousEtag: string | null): Promise<void> {
		const response = await this.send("appcast.xml", "PUT", {
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
			throw new Error(
				`Feed upload failed (${response.status}). Uploaded ZIP remains available.`
			);
	}

	private async send(
		key: string,
		method: "GET" | "PUT",
		options: Pick<RequestInit, "body" | "headers"> = {}
	): Promise<Response> {
		try {
			return await this.request(
				this.client.presign(key, { method, expiresIn: 300 }),
				{
					...options,
					method,
					signal: AbortSignal.timeout(120000),
					redirect: "error",
				}
			);
		} catch {
			throw new Error(
				"R2 request failed; check network access and bucket-scoped credentials."
			);
		}
	}
}

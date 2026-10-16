import type { ReadableStreamDefaultReader } from "node:stream/web";
import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	ReleaseUploadManifest,
	UPLOAD_PART_BYTES,
	type UploadManifest,
} from "./upload-protocol";

/** Native conditional writes plus private archive assembly and temporary-object cleanup. */
export interface PublisherBucket {
	head(key: string): Promise<{ size: number } | null>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
	put(
		key: string,
		body: ReadableStream<Uint8Array>,
		options: {
			onlyIf: { etagMatches: string } | { etagDoesNotMatch: "*" };
			sha256: string;
			httpMetadata: { contentType: string; cacheControl: string };
		}
	): Promise<{ httpEtag: string } | null>;
	delete(key: string): Promise<void>;
}

// Cloudflare supplies a fixed-length stream so R2 can accept the assembled body without buffering it.
declare const FixedLengthStream: new (
	length: number
) => TransformStream<Uint8Array, Uint8Array>;

async function archiveBody(manifest: UploadManifest, bucket: PublisherBucket) {
	const parts = manifest.parts;

	if (!parts) throw new Error("Missing archive parts.");

	const keys = Array.from(
		{ length: parts.count },
		(_, index) => `release-parts/${parts.id}/${index}.bin`
	);

	for (const [index, key] of keys.entries()) {
		const object = await bucket.head(key);

		if (
			object?.size !==
			Math.min(UPLOAD_PART_BYTES, manifest.size - index * UPLOAD_PART_BYTES)
		)
			throw new Error("Missing or incomplete archive part.");
	}

	let index = 0;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const controller = new AbortController();

	const source = new ReadableStream<Uint8Array>({
		async pull(stream) {
			for (;;) {
				if (!reader) {
					const key = keys[index++];

					if (!key) {
						stream.close();

						return;
					}

					const object = await bucket.get(key);

					if (!object) throw new Error("Archive part disappeared.");

					reader = object.body.getReader();
				}

				const chunk = await reader.read();

				if (!chunk.done) {
					stream.enqueue(chunk.value);

					return;
				}

				reader.releaseLock();
				reader = undefined;
			}
		},
		async cancel(reason) {
			await reader?.cancel(reason);
		},
	});

	const fixed = new FixedLengthStream(manifest.size);

	// Convert failures into a settled result immediately; R2 can reject a precondition without reading.
	const copied = source
		.pipeTo(fixed.writable, { signal: controller.signal })
		.then(
			() => null,
			(error: unknown) => error
		);

	return {
		body: fixed.readable,
		copied,
		cancel: async () => {
			controller.abort();

			try {
				await fixed.readable.cancel();
			} catch {
				/* R2 may already have closed the stream. */
			}

			await copied;
		},
	};
}

/** Only the public verification key is deployed; no Cloudflare credentials or private key. */
export interface PublisherEnvironment {
	UPDATES: PublisherBucket;
	PUBLIC_KEY: string;
}

const reply = (status: number, message?: string): Response =>
	new Response(message ?? null, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});

export default {
	async fetch(request: Request, env: PublisherEnvironment): Promise<Response> {
		if (request.method !== "PUT" && request.method !== "DELETE")
			return reply(405);

		let manifest: UploadManifest;

		try {
			const encoded = request.headers.get(MANIFEST_HEADER);
			const signature = request.headers.get(SIGNATURE_HEADER);

			if (
				!encoded ||
				encoded.length > 4096 ||
				!signature ||
				!/^[A-Za-z0-9+/]{86}==$/u.test(signature)
			)
				return reply(401, "Signed upload authorization required");

			const bytes = Uint8Array.from(atob(encoded), (character) =>
				character.charCodeAt(0)
			);

			const key = await crypto.subtle.importKey(
				"raw",
				Uint8Array.from(atob(env.PUBLIC_KEY), (character) =>
					character.charCodeAt(0)
				),
				"Ed25519",
				false,
				["verify"]
			);

			if (
				!(await crypto.subtle.verify(
					"Ed25519",
					key,
					Uint8Array.from(atob(signature), (character) =>
						character.charCodeAt(0)
					),
					bytes
				))
			)
				return reply(401, "Invalid upload signature");

			manifest = ReleaseUploadManifest.parse(
				JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
				request
			);
		} catch {
			return reply(401, "Invalid upload authorization");
		}

		if (
			request.headers.get("content-length") !==
			String(manifest.parts ? 0 : manifest.size)
		)
			return reply(400, "Content length does not match authorization");

		try {
			if (manifest.method === "DELETE") {
				await env.UPDATES.delete(manifest.key);

				return reply(204);
			}

			if (!manifest.parts && !request.body)
				return reply(400, "Upload body required");

			const assembled = manifest.parts
				? await archiveBody(manifest, env.UPDATES)
				: undefined;

			const body = assembled?.body ?? request.body;

			if (!body) return reply(400, "Upload body required");

			const feed = manifest.key === "appcast.xml";
			const probe = manifest.key.startsWith("release-checks/");

			let object: { httpEtag: string } | null;

			try {
				object = await env.UPDATES.put(manifest.key, body, {
					onlyIf:
						manifest.ifMatch !== null
							? { etagMatches: manifest.ifMatch.slice(1, -1) }
							: { etagDoesNotMatch: "*" },
					sha256: manifest.sha256,
					httpMetadata: {
						contentType: feed
							? "application/xml"
							: probe
								? "text/plain"
								: "application/zip",
						cacheControl:
							feed || probe
								? "no-store"
								: "public, max-age=31536000, immutable",
					},
				});

				if (object && assembled) {
					const error = await assembled.copied;

					if (error) throw error;
				}
			} finally {
				await assembled?.cancel();
			}

			if (!object) return reply(412, "Write precondition failed");

			return new Response(null, {
				status: 200,
				headers: { ETag: object.httpEtag, "Cache-Control": "no-store" },
			});
		} catch {
			return reply(
				503,
				"Upload rejected; inspect release state before retrying"
			);
		}
	},
};

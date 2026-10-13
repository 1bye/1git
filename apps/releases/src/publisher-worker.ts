import {
	MANIFEST_HEADER,
	SIGNATURE_HEADER,
	ReleaseUploadManifest,
	type UploadManifest,
} from "./upload-protocol";

/** Only native conditional writes and isolated probe cleanup are needed. */
export interface PublisherBucket {
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

		if (request.headers.get("content-length") !== String(manifest.size))
			return reply(400, "Content length does not match authorization");

		try {
			if (manifest.method === "DELETE") {
				await env.UPDATES.delete(manifest.key);

				return reply(204);
			}

			if (!request.body) return reply(400, "Upload body required");

			const feed = manifest.key === "appcast.xml";
			const probe = manifest.key.startsWith("release-checks/");

			const object = await env.UPDATES.put(manifest.key, request.body, {
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
						feed || probe ? "no-store" : "public, max-age=31536000, immutable",
				},
			});

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

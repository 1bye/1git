/** Domain separation prevents app/archive signatures from authorizing uploads. */
export const UPLOAD_DOMAIN = "1git-release-upload-v1";
export const UPLOAD_LIFETIME_MS = 5 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 96 * 1024 * 1024;
/** Large archives travel as bounded private parts, then one conditional streamed write. */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const UPLOAD_PART_BYTES = 64 * 1024 * 1024;
export const MANIFEST_HEADER = "X-1git-Manifest";
export const SIGNATURE_HEADER = "X-1git-Signature";

const archive =
	/^1git-(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})-macos-arm64\.zip$/u;

const probe = /^release-checks\/[a-f0-9-]{36}\.txt$/u;
const part = /^release-parts\/[a-f0-9-]{36}\/[0-7]\.bin$/u;
const etag = /^"[^"\r\n]+"$/u;

/** Every authorization is bound to one destination, body and conditional operation. */
export interface UploadManifest {
	domain: typeof UPLOAD_DOMAIN;
	origin: string;
	key: string;
	method: "PUT" | "DELETE";
	sha256: string;
	size: number;
	expiresAt: number;
	ifMatch: string | null;
	ifNoneMatch: string | null;
	parts?: { id: string; count: number };
}

/** Validates the signed payload before any bucket access. */
export class ReleaseUploadManifest {
	static parse(
		value: unknown,
		request: Request,
		now = Date.now()
	): UploadManifest {
		if (
			typeof value !== "object" ||
			value === null ||
			!("domain" in value) ||
			value.domain !== UPLOAD_DOMAIN ||
			!("origin" in value) ||
			value.origin !== new URL(request.url).origin ||
			!("key" in value) ||
			typeof value.key !== "string" ||
			value.key !== new URL(request.url).pathname.slice(1) ||
			!("method" in value) ||
			(value.method !== "PUT" && value.method !== "DELETE") ||
			value.method !== request.method ||
			!("sha256" in value) ||
			typeof value.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/u.test(value.sha256) ||
			!("size" in value) ||
			typeof value.size !== "number" ||
			!Number.isSafeInteger(value.size) ||
			value.size < 0 ||
			value.size > MAX_ARCHIVE_BYTES ||
			!("expiresAt" in value) ||
			typeof value.expiresAt !== "number" ||
			!Number.isSafeInteger(value.expiresAt) ||
			value.expiresAt < now ||
			value.expiresAt > now + UPLOAD_LIFETIME_MS + 30000 ||
			!("ifMatch" in value) ||
			(value.ifMatch !== null &&
				(typeof value.ifMatch !== "string" || !etag.test(value.ifMatch))) ||
			!("ifNoneMatch" in value) ||
			(value.ifNoneMatch !== null && value.ifNoneMatch !== "*")
		)
			throw new Error("Invalid upload authorization.");

		const isProbe = probe.test(value.key);
		const isArchive = archive.test(value.key);
		const isFeed = value.key === "appcast.xml";
		const isPart = part.test(value.key);
		let parts: UploadManifest["parts"];

		if ("parts" in value) {
			const input = value.parts;

			if (
				!isArchive ||
				value.method !== "PUT" ||
				value.size <= MAX_UPLOAD_BYTES ||
				typeof input !== "object" ||
				input === null ||
				!("id" in input) ||
				typeof input.id !== "string" ||
				!/^[a-f0-9-]{36}$/u.test(input.id) ||
				!("count" in input) ||
				input.count !== Math.ceil(value.size / UPLOAD_PART_BYTES)
			)
				throw new Error("Invalid archive parts.");

			parts = {
				id: input.id,
				count: Math.ceil(value.size / UPLOAD_PART_BYTES),
			};
		} else if (value.size > MAX_UPLOAD_BYTES)
			throw new Error("Upload exceeds the single-request limit.");

		if (!isProbe && !isArchive && !isFeed && !isPart)
			throw new Error("Invalid upload key.");

		if (value.method === "DELETE") {
			if (
				(!isProbe && !isPart) ||
				value.size !== 0 ||
				value.ifMatch !== null ||
				value.ifNoneMatch !== null
			)
				throw new Error("Only test objects may be deleted.");
		} else {
			if ((value.ifMatch === null) === (value.ifNoneMatch === null))
				throw new Error("Exactly one write condition is required.");

			if ((isArchive || isPart) && value.ifNoneMatch !== "*")
				throw new Error("Archives are immutable.");

			if (isPart && value.size > UPLOAD_PART_BYTES)
				throw new Error("Archive part exceeds the size limit.");

			if (isFeed && value.size > 1024 * 1024)
				throw new Error("Feed exceeds the 1 MiB limit.");
		}

		return {
			domain: UPLOAD_DOMAIN,
			origin: value.origin,
			key: value.key,
			method: value.method,
			sha256: value.sha256,
			size: value.size,
			expiresAt: value.expiresAt,
			ifMatch: value.ifMatch,
			ifNoneMatch: value.ifNoneMatch,
			...(parts ? { parts } : {}),
		};
	}
}

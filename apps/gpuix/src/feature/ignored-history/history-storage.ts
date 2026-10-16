import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	randomUUID,
} from "node:crypto";
import { constants } from "node:fs";
import {
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CredentialVault } from "../accounts/lib/native-credentials";

export const historyChunkBytes = 1024 * 1024;
export const historyMaxFiles = 100_000;
const maxManifestBytes = 32 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/u;

/** An immutable file version; an empty chunk list with deleted=true records absence. */
export interface HistoryVersion {
	id: string;
	at: string;
	size: number;
	mode: number;
	deleted: boolean;
	chunks: string[];
}

/** Baselines survive automatic retention; each worktree owns a separate encrypted manifest. */
export interface HistoryManifest {
	version: 1;
	initialized: boolean;
	files: Record<
		string,
		{ baseline: string | null; versions: HistoryVersion[] }
	>;
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates relative selections and decrypted metadata before any filesystem access. */
export function historyPath(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 4096 ||
		/[\\\p{Cc}]/u.test(value) ||
		value
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					part.toLowerCase() === ".git"
			)
	)
		throw new Error(
			"Choose a repository-relative file or folder without links or Git metadata."
		);

	return value;
}

const seal = (key: Buffer, data: Buffer, scope: string): Buffer => {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);

	cipher.setAAD(Buffer.from(scope));
	const content = Buffer.concat([cipher.update(data), cipher.final()]);

	return Buffer.concat([iv, cipher.getAuthTag(), content]);
};

const unseal = (key: Buffer, data: Buffer, scope: string): Buffer => {
	if (data.length < 28) throw new Error("Invalid encrypted history.");

	const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));

	decipher.setAAD(Buffer.from(scope));
	decipher.setAuthTag(data.subarray(12, 28));

	try {
		return Buffer.concat([
			decipher.update(data.subarray(28)),
			decipher.final(),
		]);
	} catch {
		throw new Error(
			"History could not be decrypted. Saved versions were left unchanged."
		);
	}
};

/** Atomic owner-only files; ciphertext is the only snapshot data written to application storage. */
export async function historyWrite(
	path: string,
	bytes: Buffer | string
): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;

	try {
		const file = await open(temporary, "wx", 0o600);

		try {
			await file.writeFile(bytes);
			await file.sync();
		} finally {
			await file.close();
		}

		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Authenticated encrypted chunks and metadata. The caller owns serialization and repository identity. */
export class HistoryStorage {
	private readonly encryptionKey: Buffer;
	private readonly digestKey: Buffer;

	constructor(
		readonly directory: string,
		key: Buffer
	) {
		this.encryptionKey = Buffer.from(
			hkdfSync("sha256", key, "1git-ignored-history-v1", "encryption", 32)
		);
		this.digestKey = Buffer.from(
			hkdfSync("sha256", key, "1git-ignored-history-v1", "content-identity", 32)
		);
		key.fill(0);
	}

	static identity(value: string): string {
		return createHash("sha256").update(value).digest("hex");
	}

	static async key(
		vault: CredentialVault,
		identity: string,
		create: boolean
	): Promise<Buffer> {
		// Domain-separated keys use the existing application-only OS vault namespace.
		const name = `1git-hosting-v1:${HistoryStorage.identity(`1git-ignored-history-v1:${identity}`)}`;
		let saved = await vault.read(name);

		if (saved === null && create) {
			saved = randomBytes(32).toString("hex");
			await vault.write(name, saved);
		}

		if (saved === null || !digestPattern.test(saved))
			throw new Error(
				"The history encryption key is unavailable. Unlock the OS credential store; no replacement key was created."
			);

		return Buffer.from(saved, "hex");
	}

	id(bytes: Buffer | string): string {
		return createHmac("sha256", this.digestKey).update(bytes).digest("hex");
	}

	async load(): Promise<HistoryManifest> {
		let encrypted: Buffer;

		try {
			const path = join(this.directory, "history.enc");

			if ((await stat(path)).size > maxManifestBytes)
				throw new Error("History metadata exceeds its safe size limit.");

			encrypted = await readFile(path);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return { version: 1, initialized: false, files: Object.create(null) };

			throw error;
		}

		const bytes = unseal(this.encryptionKey, encrypted, this.directory);

		try {
			return HistoryStorage.manifest(JSON.parse(bytes.toString("utf8")));
		} finally {
			bytes.fill(0);
		}
	}

	async save(manifest: HistoryManifest): Promise<void> {
		const bytes = Buffer.from(JSON.stringify(manifest));

		try {
			if (bytes.length + 28 > maxManifestBytes)
				throw new Error(
					"History metadata is full. Reduce the monitored selection."
				);

			await historyWrite(
				join(this.directory, "history.enc"),
				seal(this.encryptionKey, bytes, this.directory)
			);
		} finally {
			bytes.fill(0);
		}
	}

	async chunk(
		bytes: Buffer,
		budget: { used: number; limit: number }
	): Promise<string> {
		const id = this.id(bytes);
		const path = join(this.directory, "chunks", id);

		try {
			await stat(path);

			return id;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}

		if (budget.used + bytes.length + 28 > budget.limit)
			throw new Error(
				"History storage budget reached. Capture is paused; increase the budget or remove old history. Existing baselines remain available."
			);

		await historyWrite(path, seal(this.encryptionKey, bytes, id));
		budget.used += bytes.length + 28;

		return id;
	}

	async readChunk(id: string): Promise<Buffer> {
		if (!digestPattern.test(id)) throw new Error("Invalid history chunk.");

		const file = await open(
			join(this.directory, "chunks", id),
			constants.O_RDONLY | constants.O_NOFOLLOW
		);

		try {
			if ((await file.stat()).size > historyChunkBytes + 28)
				throw new Error("Invalid history chunk size.");

			const bytes = unseal(this.encryptionKey, await file.readFile(), id);

			if (this.id(bytes) !== id)
				throw new Error("History content failed verification.");

			return bytes;
		} finally {
			await file.close();
		}
	}

	async collect(manifest: HistoryManifest): Promise<number> {
		const referenced = new Set(
			Object.values(manifest.files).flatMap((file) =>
				file.versions.flatMap((version) => version.chunks)
			)
		);

		const directory = join(this.directory, "chunks");

		await mkdir(directory, { recursive: true, mode: 0o700 });
		let used = 0;

		for (const id of await readdir(directory)) {
			if (!digestPattern.test(id)) continue;

			const path = join(directory, id);

			if (referenced.has(id)) used += (await stat(path)).size;
			else await rm(path);
		}

		return used;
	}

	private static manifest(value: unknown): HistoryManifest {
		if (
			!record(value) ||
			value.version !== 1 ||
			typeof value.initialized !== "boolean" ||
			!record(value.files) ||
			Object.keys(value.files).length > historyMaxFiles
		)
			throw new Error("Invalid history metadata.");

		const files: HistoryManifest["files"] = Object.create(null);

		for (const [path, file] of Object.entries(value.files)) {
			historyPath(path);

			if (
				!record(file) ||
				(file.baseline !== null &&
					(typeof file.baseline !== "string" ||
						!digestPattern.test(file.baseline))) ||
				!Array.isArray(file.versions) ||
				!file.versions.length ||
				file.versions.length > 102
			)
				throw new Error("Invalid file history.");

			const versions: HistoryVersion[] = [];

			for (const item of file.versions) {
				if (
					!record(item) ||
					typeof item.id !== "string" ||
					!digestPattern.test(item.id) ||
					typeof item.at !== "string" ||
					!Number.isFinite(Date.parse(item.at)) ||
					typeof item.size !== "number" ||
					!Number.isSafeInteger(item.size) ||
					item.size < 0 ||
					typeof item.mode !== "number" ||
					!Number.isInteger(item.mode) ||
					item.mode < 0 ||
					item.mode > 0o777 ||
					typeof item.deleted !== "boolean" ||
					!Array.isArray(item.chunks) ||
					!item.chunks.every(
						(id): id is string =>
							typeof id === "string" && digestPattern.test(id)
					) ||
					item.chunks.length !==
						(item.deleted ? 0 : Math.ceil(item.size / historyChunkBytes)) ||
					(item.deleted && item.size !== 0)
				)
					throw new Error("Invalid saved version.");

				versions.push({
					id: item.id,
					at: item.at,
					size: item.size,
					mode: item.mode,
					deleted: item.deleted,
					chunks: item.chunks,
				});
			}

			if (
				file.baseline !== null &&
				!versions.some((item) => item.id === file.baseline)
			)
				throw new Error("Missing history baseline.");

			files[path] = { baseline: file.baseline, versions };
		}

		return { version: 1, initialized: value.initialized, files };
	}
}

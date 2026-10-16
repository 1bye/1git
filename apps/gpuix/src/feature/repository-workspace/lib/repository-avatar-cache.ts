import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { imageProcessor } from "./image-processing";

const maxEntries = 256;
const maxImageBytes = 64 * 1024;
const cacheFilename = /^[a-f0-9]{64}\.png$/u;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const dataPrefix = "data:image/png;base64,";

const isThumbnail = (bytes: Buffer): boolean =>
	bytes.length >= 24 &&
	bytes.length <= maxImageBytes &&
	bytes.subarray(0, 8).equals(pngSignature) &&
	bytes.readUInt32BE(16) === 64 &&
	bytes.readUInt32BE(20) === 64;

/** Best-effort private storage for bounded, decoded thumbnails; filenames contain no repository paths. */
export class RepositoryAvatarCache {
	constructor(readonly directory: string) {}

	static defaultPath(): string {
		if (process.env.GPUIX_AVATAR_CACHE_PATH)
			return process.env.GPUIX_AVATAR_CACHE_PATH;

		let root = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");

		if (process.platform === "darwin")
			root = join(homedir(), "Library", "Caches");

		if (process.platform === "win32")
			root = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");

		return join(root, "1git-gpuix", "avatars-v1");
	}

	async read(key: string): Promise<{ src: string; updatedAt: number } | null> {
		try {
			const path = this.path(key);
			const info = await stat(path);

			if (!info.isFile() || info.size > maxImageBytes) return null;

			const bytes = await readFile(path);

			if (!isThumbnail(bytes)) return null;

			// Decode fully so truncated or corrupt files never reach the native image renderer.
			const png = await imageProcessor(bytes, { limitInputPixels: 64 * 64 })
				.png()
				.toBuffer();

			return {
				src: `${dataPrefix}${png.toString("base64")}`,
				updatedAt: info.mtimeMs,
			};
		} catch {
			return null;
		}
	}

	async write(key: string, src: string): Promise<void> {
		if (!src.startsWith(dataPrefix)) return;

		const bytes = Buffer.from(src.slice(dataPrefix.length), "base64");

		if (!isThumbnail(bytes)) return;

		const path = this.path(key);
		const temporary = `${path}.${randomUUID()}.tmp`;

		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
			await rename(temporary, path);
			await this.trim();
		} catch {
			// An unavailable cache must not prevent a downloaded image from appearing.
		} finally {
			await rm(temporary, { force: true }).catch(() => {});
		}
	}

	private path(key: string): string {
		return join(
			this.directory,
			`${createHash("sha256").update(key).digest("hex")}.png`
		);
	}

	private async trim(): Promise<void> {
		const names = (await readdir(this.directory)).filter((name) =>
			cacheFilename.test(name)
		);

		if (names.length <= maxEntries) return;

		const files = await Promise.all(
			names.map(async (name) => {
				const path = join(this.directory, name);

				return { path, updatedAt: (await stat(path)).mtimeMs };
			})
		);

		files.sort((left, right) => left.updatedAt - right.updatedAt);
		await Promise.allSettled(
			files
				.slice(0, files.length - maxEntries)
				.map(async ({ path }) => await rm(path, { force: true }))
		);
	}
}

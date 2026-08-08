import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryOwnerAvatarResult } from "../../shared/repository-owner-avatar.js";

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_API_URL = "https://api.github.com/users";
const GITHUB_LOGIN_PATTERN = /^[a-z\d-]{1,100}$/i;
const MAX_AVATAR_BYTES = 1_000_000;
const MAX_CACHE_DATA_URL_LENGTH = 1_400_000;
const REQUEST_TIMEOUT_MS = 5000;
const USER_AGENT = "1git-desktop";
const ALLOWED_AVATAR_HOSTS = new Set([
	"avatars.githubusercontent.com",
	"github.com",
]);
const ALLOWED_IMAGE_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);
const IMAGE_DATA_URL_PATTERN =
	/^data:image\/(?:gif|jpeg|png|webp);base64,[a-z\d+/=]+$/i;

interface GithubAvatarCacheRecord {
	readonly cachedAt: number;
	readonly dataUrl: string;
	readonly login: string;
	readonly version: typeof CACHE_VERSION;
}

export type GithubAvatarFetch = (
	url: string,
	init?: RequestInit
) => Promise<Response>;

interface GithubAvatarCacheOptions {
	readonly cacheDirectory: string;
	readonly fetch?: GithubAvatarFetch;
	readonly now?: () => number;
}

const unavailableResult = (): RepositoryOwnerAvatarResult => ({
	status: "unavailable",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseCacheRecord = (
	content: string,
	expectedLogin: string
): GithubAvatarCacheRecord | null => {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		return null;
	}
	if (!isRecord(value)) {
		return null;
	}

	const { cachedAt, dataUrl, login, version } = value;
	if (
		version !== CACHE_VERSION ||
		login !== expectedLogin ||
		typeof cachedAt !== "number" ||
		!Number.isFinite(cachedAt) ||
		typeof dataUrl !== "string" ||
		dataUrl.length > MAX_CACHE_DATA_URL_LENGTH ||
		!IMAGE_DATA_URL_PATTERN.test(dataUrl)
	) {
		return null;
	}

	return { cachedAt, dataUrl, login, version };
};

const avatarUrlFromAccount = (value: unknown): URL | null => {
	if (!isRecord(value) || typeof value.avatar_url !== "string") {
		return null;
	}

	try {
		const avatarUrl = new URL(value.avatar_url);
		if (
			avatarUrl.protocol !== "https:" ||
			!ALLOWED_AVATAR_HOSTS.has(avatarUrl.hostname)
		) {
			return null;
		}
		return avatarUrl;
	} catch {
		return null;
	}
};

const contentTypeFromResponse = (response: Response): string | null => {
	const contentType = response.headers.get("content-type");
	return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
};

const exceedsDeclaredSize = (response: Response): boolean => {
	const contentLength = response.headers.get("content-length");
	if (!contentLength) {
		return false;
	}
	const size = Number(contentLength);
	return Number.isFinite(size) && size > MAX_AVATAR_BYTES;
};

export class GithubAvatarCache {
	private readonly cacheDirectory: string;
	private readonly fetch: GithubAvatarFetch;
	private readonly inFlight = new Map<
		string,
		Promise<RepositoryOwnerAvatarResult>
	>();
	private readonly memory = new Map<string, GithubAvatarCacheRecord>();
	private readonly now: () => number;

	constructor({
		cacheDirectory,
		fetch = globalThis.fetch,
		now = Date.now,
	}: GithubAvatarCacheOptions) {
		if (cacheDirectory.length === 0) {
			throw new Error("GitHub avatar cache directory must not be empty.");
		}
		this.cacheDirectory = cacheDirectory;
		this.fetch = fetch;
		this.now = now;
	}

	async get(login: string): Promise<RepositoryOwnerAvatarResult> {
		const normalizedLogin = login.trim().toLowerCase();
		if (!GITHUB_LOGIN_PATTERN.test(normalizedLogin)) {
			return unavailableResult();
		}

		const memoryRecord = this.memory.get(normalizedLogin);
		if (memoryRecord && this.isFresh(memoryRecord)) {
			return { dataUrl: memoryRecord.dataUrl, status: "available" };
		}

		const pending = this.inFlight.get(normalizedLogin);
		if (pending) {
			return await pending;
		}

		const request = this.load(normalizedLogin);
		this.inFlight.set(normalizedLogin, request);
		try {
			return await request;
		} finally {
			this.inFlight.delete(normalizedLogin);
		}
	}

	private cacheFilePath(login: string): string {
		const key = createHash("sha256").update(login).digest("hex");
		return join(this.cacheDirectory, `${key}.json`);
	}

	private async fetchAvatarDataUrl(login: string): Promise<string | null> {
		try {
			const accountResponse = await this.fetch(
				`${GITHUB_API_URL}/${encodeURIComponent(login)}`,
				{
					headers: {
						Accept: "application/vnd.github+json",
						"User-Agent": USER_AGENT,
						"X-GitHub-Api-Version": GITHUB_API_VERSION,
					},
					redirect: "error",
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				}
			);
			if (!accountResponse.ok) {
				return null;
			}

			const account: unknown = await accountResponse.json();
			const avatarUrl = avatarUrlFromAccount(account);
			if (!avatarUrl) {
				return null;
			}

			const avatarResponse = await this.fetch(avatarUrl.toString(), {
				headers: {
					Accept: "image/*",
					"User-Agent": USER_AGENT,
				},
				redirect: "error",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			const contentType = contentTypeFromResponse(avatarResponse);
			if (
				!(
					avatarResponse.ok &&
					contentType &&
					ALLOWED_IMAGE_TYPES.has(contentType)
				) ||
				exceedsDeclaredSize(avatarResponse)
			) {
				return null;
			}

			const bytes = Buffer.from(await avatarResponse.arrayBuffer());
			if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
				return null;
			}
			return `data:${contentType};base64,${bytes.toString("base64")}`;
		} catch {
			return null;
		}
	}

	private isFresh(record: GithubAvatarCacheRecord): boolean {
		return this.now() - record.cachedAt < CACHE_TTL_MS;
	}

	private async load(login: string): Promise<RepositoryOwnerAvatarResult> {
		const diskRecord = await this.read(login);
		if (diskRecord && this.isFresh(diskRecord)) {
			this.memory.set(login, diskRecord);
			return { dataUrl: diskRecord.dataUrl, status: "available" };
		}

		const dataUrl = await this.fetchAvatarDataUrl(login);
		if (dataUrl) {
			const record: GithubAvatarCacheRecord = {
				cachedAt: this.now(),
				dataUrl,
				login,
				version: CACHE_VERSION,
			};
			this.memory.set(login, record);
			await this.write(record);
			return { dataUrl, status: "available" };
		}

		if (diskRecord) {
			this.memory.set(login, diskRecord);
			return { dataUrl: diskRecord.dataUrl, status: "available" };
		}
		return unavailableResult();
	}

	private async read(login: string): Promise<GithubAvatarCacheRecord | null> {
		try {
			const content = await readFile(this.cacheFilePath(login), "utf8");
			return parseCacheRecord(content, login);
		} catch {
			return null;
		}
	}

	private async write(record: GithubAvatarCacheRecord): Promise<void> {
		const filePath = this.cacheFilePath(record.login);
		const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await mkdir(this.cacheDirectory, {
				mode: DIRECTORY_MODE,
				recursive: true,
			});
			await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: FILE_MODE,
			});
			await rename(temporaryPath, filePath);
			await chmod(filePath, FILE_MODE);
		} catch {
			try {
				await rm(temporaryPath, { force: true });
			} catch {
				// Cache cleanup is best effort.
			}
		}
	}
}

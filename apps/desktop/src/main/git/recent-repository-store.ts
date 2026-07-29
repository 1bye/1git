import { randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { RecentRepositoryRecord } from "../../shared/repository-session.js";

const RECENT_REPOSITORY_FILE_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

interface RecentRepositoryDocument {
	readonly repositories: readonly RecentRepositoryRecord[];
	readonly version: typeof RECENT_REPOSITORY_FILE_VERSION;
}

export interface RecentRepositoryStore {
	readonly load: () => readonly RecentRepositoryRecord[];
	readonly save: (repositories: readonly RecentRepositoryRecord[]) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseRecentRepository = (
	value: unknown
): RecentRepositoryRecord | null => {
	if (!isRecord(value)) {
		return null;
	}
	const { lastOpenedAt, path } = value;
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		typeof lastOpenedAt !== "string" ||
		Number.isNaN(Date.parse(lastOpenedAt))
	) {
		return null;
	}
	return { lastOpenedAt, path };
};

const parseDocument = (content: string): RecentRepositoryDocument | null => {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		return null;
	}
	if (
		!isRecord(value) ||
		value.version !== RECENT_REPOSITORY_FILE_VERSION ||
		!Array.isArray(value.repositories)
	) {
		return null;
	}

	const repositories: RecentRepositoryRecord[] = [];
	for (const candidate of value.repositories) {
		const repository = parseRecentRepository(candidate);
		if (repository) {
			repositories.push(repository);
		}
	}
	return {
		repositories,
		version: RECENT_REPOSITORY_FILE_VERSION,
	};
};

const isMissingFile = (error: unknown): boolean =>
	error instanceof Error &&
	"code" in error &&
	(error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Persists only canonical local paths and timestamps in Electron's user-data
 * directory. Remote URLs and credentials are deliberately outside this schema.
 */
export class JsonRecentRepositoryStore implements RecentRepositoryStore {
	private readonly filePath: string;

	constructor(filePath: string) {
		if (filePath.length === 0) {
			throw new Error("Recent repository file path must not be empty.");
		}
		this.filePath = filePath;
	}

	load(): readonly RecentRepositoryRecord[] {
		let content: string;
		try {
			content = readFileSync(this.filePath, "utf8");
		} catch (error: unknown) {
			if (isMissingFile(error)) {
				return [];
			}
			throw error;
		}
		return parseDocument(content)?.repositories ?? [];
	}

	save(repositories: readonly RecentRepositoryRecord[]): void {
		const document: RecentRepositoryDocument = {
			repositories: repositories.map(({ lastOpenedAt, path }) => ({
				lastOpenedAt,
				path,
			})),
			version: RECENT_REPOSITORY_FILE_VERSION,
		};
		const directory = dirname(this.filePath);
		const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
		mkdirSync(directory, { mode: DIRECTORY_MODE, recursive: true });

		try {
			writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: FILE_MODE,
			});
			renameSync(temporaryPath, this.filePath);
			chmodSync(this.filePath, FILE_MODE);
		} catch (error: unknown) {
			rmSync(temporaryPath, { force: true });
			throw error;
		}
	}
}

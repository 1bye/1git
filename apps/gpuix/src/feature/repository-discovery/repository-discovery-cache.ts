import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { MachineLocation } from "../machines/machine-location";
import type { RepositoryDiscoveryProgress } from "./repository-discovery";

/** A completed folder scan, incrementally updated by confirmed in-app repositories. */
export interface RepositoryDiscoverySnapshot {
	readonly canonicalPath: string;
	readonly progress: RepositoryDiscoveryProgress;
}

const maxCacheBytes = 2 * 1024 * 1024;
const maxRepositories = 5_000;
const cacheFilename = /^[a-f0-9]{64}\.json$/;

const validPath = (value: unknown): value is string =>
	typeof value === "string" && isAbsolute(value) && !value.includes("\0");

const validCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Best-effort private scan storage, separate from session intent and keyed by machine/home and root. */
export class RepositoryDiscoveryCache {
	constructor(readonly directory: string) {}

	/** Includes a confirmed repository inside this root, preserving scan metadata and the path limit. */
	static includeRepository(
		snapshot: RepositoryDiscoverySnapshot,
		path: string
	): RepositoryDiscoverySnapshot {
		if (
			!validPath(path) ||
			MachineLocation.isRemote(path) !==
				MachineLocation.isRemote(snapshot.canonicalPath) ||
			snapshot.progress.paths.includes(path)
		)
			return snapshot;

		const suffix = relative(snapshot.canonicalPath, path);

		if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`))
			return snapshot;

		const paths = [...snapshot.progress.paths, path];

		return {
			...snapshot,
			progress: {
				...snapshot.progress,
				paths: paths.slice(-maxRepositories),
				limited: snapshot.progress.limited || paths.length > maxRepositories,
			},
		};
	}

	read(scope: string, root: string): RepositoryDiscoverySnapshot | undefined {
		return this.readSnapshot(this.path(scope, root));
	}

	private readSnapshot(path: string): RepositoryDiscoverySnapshot | undefined {
		try {
			if (statSync(path).size > maxCacheBytes) return;

			const value: unknown = JSON.parse(readFileSync(path, "utf8"));

			if (
				!value ||
				typeof value !== "object" ||
				!("version" in value) ||
				value.version !== 1 ||
				!("canonicalPath" in value) ||
				!validPath(value.canonicalPath) ||
				!("progress" in value) ||
				!value.progress ||
				typeof value.progress !== "object"
			)
				return;

			const { progress } = value;

			if (
				!("paths" in progress) ||
				!Array.isArray(progress.paths) ||
				progress.paths.length > maxRepositories ||
				!progress.paths.every(validPath) ||
				!("scanned" in progress) ||
				!validCount(progress.scanned) ||
				!("skipped" in progress) ||
				!validCount(progress.skipped) ||
				!("limited" in progress) ||
				typeof progress.limited !== "boolean"
			)
				return;

			return {
				canonicalPath: value.canonicalPath,
				progress: {
					paths: progress.paths,
					scanned: progress.scanned,
					skipped: progress.skipped,
					limited: progress.limited,
				},
			};
		} catch {
			// A missing or damaged cache falls back to discovery.
			return;
		}
	}

	write(
		scope: string,
		root: string,
		snapshot: RepositoryDiscoverySnapshot
	): void {
		this.writeSnapshot(this.path(scope, root), snapshot);
	}

	private writeSnapshot(
		path: string,
		snapshot: RepositoryDiscoverySnapshot
	): void {
		const content = JSON.stringify({ version: 1, ...snapshot });

		if (Buffer.byteLength(content) > maxCacheBytes) return;

		const temporary = `${path}.${randomUUID()}.tmp`;

		try {
			mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			renameSync(temporary, path);
		} catch {
			// Cache storage must not prevent repositories from appearing.
		} finally {
			try {
				rmSync(temporary, { force: true });
			} catch {
				// The cache directory may be unavailable or read-only.
			}
		}
	}

	/** Updates existing cached roots across spaces and machines without scanning repository folders. */
	remember(repository: string): void {
		try {
			for (const filename of readdirSync(this.directory)) {
				if (!cacheFilename.test(filename)) continue;

				const path = join(this.directory, filename);
				const snapshot = this.readSnapshot(path);

				if (!snapshot) continue;

				const next = RepositoryDiscoveryCache.includeRepository(
					snapshot,
					repository
				);

				if (next !== snapshot) this.writeSnapshot(path, next);
			}
		} catch {
			// Missing or unavailable cache storage must not interrupt repository setup or opening.
		}
	}

	remove(scope: string, root: string): void {
		try {
			rmSync(this.path(scope, root), { force: true });
		} catch {
			// Removing folder tracking must work even if cache cleanup fails.
		}
	}

	private path(scope: string, root: string): string {
		const key = createHash("sha256")
			.update(JSON.stringify([scope, root]))
			.digest("hex");

		return join(this.directory, `${key}.json`);
	}
}

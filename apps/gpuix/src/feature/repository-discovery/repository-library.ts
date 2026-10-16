import { basename, isAbsolute, normalize, relative, sep } from "node:path";

/** Local browsing intent; favorites do not change repository history or files. */
export interface RepositoryLibraryPreferences {
	readonly starred: readonly string[];
	readonly view: "tiles" | "list";
	readonly folder?: string;
	readonly machine?: string;
}

export interface RepositoryFolder {
	readonly path: string;
	readonly canonicalPath: string;
}

export interface RepositoryFolderGroup {
	readonly id: string;
	readonly name: string;
	readonly path?: string;
	readonly paths: readonly string[];
}

const validPath = (value: unknown): value is string =>
	typeof value === "string" && isAbsolute(value) && !value.includes("\0");

/** Groups by real scan roots, not guessed names; the deepest root owns an overlap. */
export class RepositoryLibrary {
	private constructor() {}

	static preferences(value: unknown): RepositoryLibraryPreferences {
		const record =
			typeof value === "object" && value !== null
				? (value as Record<string, unknown>)
				: {};

		return {
			...(typeof record.machine === "string" &&
			/^[a-f0-9-]{36}$/.test(record.machine)
				? { machine: record.machine }
				: {}),
			starred: Array.isArray(record.starred)
				? [
						...new Set(
							record.starred.filter(validPath).map((path) => normalize(path))
						),
					].slice(0, 5000)
				: [],
			// Legacy filter values become tile layout without losing stars or folder intent.
			view: record.view === "list" ? "list" : "tiles",
			...(record.folder === "other" || validPath(record.folder)
				? {
						folder:
							record.folder === "other" ? "other" : normalize(record.folder),
					}
				: {}),
		};
	}

	static isDefault(value: RepositoryLibraryPreferences): boolean {
		return (
			!value.starred.length &&
			value.view === "tiles" &&
			!value.folder &&
			!value.machine
		);
	}

	static star(
		value: RepositoryLibraryPreferences,
		path: string,
		starred: boolean
	): RepositoryLibraryPreferences {
		return {
			...value,
			starred: starred
				? [...new Set([...value.starred, path])]
				: value.starred.filter((item) => item !== path),
		};
	}

	static groups(
		paths: readonly string[],
		folders: readonly RepositoryFolder[]
	): readonly RepositoryFolderGroup[] {
		const groups = folders.map((folder) => ({
			id: folder.path,
			path: folder.path,
			name: basename(folder.path) || folder.path,
			paths: [] as string[],
		}));

		const other: RepositoryFolderGroup & { paths: string[] } = {
			id: "other",
			name: "Other repositories",
			paths: [],
		};

		const roots = folders
			.map((folder, index) => ({
				canonicalPath: normalize(folder.canonicalPath),
				group: groups[index]!,
			}))
			.sort(
				(left, right) => right.canonicalPath.length - left.canonicalPath.length
			);

		for (const path of new Set(paths.map((item) => normalize(item)))) {
			const owner = roots.find(({ canonicalPath }) => {
				const suffix = relative(canonicalPath, path);

				return (
					suffix === "" ||
					(!isAbsolute(suffix) &&
						suffix !== ".." &&
						!suffix.startsWith(`..${sep}`))
				);
			});

			(owner?.group ?? other).paths.push(path);
		}

		return other.paths.length ? [...groups, other] : groups;
	}
}

import type { WorkspaceEntry } from "../types";

/** File-pane presentation shared by live and saved Git changes. */
export type RepositoryFileLayout = "list" | "tree";

/** A directory groups Git records, including paths absent from the working filesystem. */
export interface RepositoryFileFolder {
	readonly kind: "folder";
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly paths: readonly string[];
	readonly fileIds: readonly string[];
	readonly children: readonly RepositoryFileNode[];
}

/** File records retain their original identity and mutation metadata. */
export type RepositoryFileNode =
	| RepositoryFileFolder
	| {
			readonly kind: "file";
			readonly id: string;
			readonly entry: WorkspaceEntry;
	  };

/** One visible, constant-height row in the native virtual list. */
export type RepositoryFileTreeRow = RepositoryFileNode & {
	readonly depth: number;
	readonly parentId: string | null;
};

interface Directory {
	path: string;
	name: string;
	folders: Map<string, Directory>;
	files: WorkspaceEntry[];
	fileIds: string[];
}

const compareNames = (left: string, right: string): number =>
	left.localeCompare(right, undefined, { numeric: true }) ||
	(left < right ? -1 : left > right ? 1 : 0);

/** Pure Git-path grouping and visibility; never reads the local filesystem. */
export class RepositoryFileTree {
	static path(entry: WorkspaceEntry): string {
		return entry.change?.path ?? entry.commitFile?.path ?? entry.title;
	}

	static build(
		entries: readonly WorkspaceEntry[]
	): readonly RepositoryFileNode[] {
		const root: Directory = {
			path: "",
			name: "",
			folders: new Map(),
			files: [],
			fileIds: [],
		};

		for (const entry of entries) {
			const parts = RepositoryFileTree.path(entry).split("/");
			let directory = root;

			for (const part of parts.slice(0, -1)) {
				let child = directory.folders.get(part);

				if (!child) {
					child = {
						path: directory.path ? `${directory.path}/${part}` : part,
						name: part,
						folders: new Map(),
						files: [],
						fileIds: [],
					};
					directory.folders.set(part, child);
				}

				child.fileIds.push(entry.id);
				directory = child;
			}

			directory.files.push(entry);
		}

		return RepositoryFileTree.children(root);
	}

	private static children(directory: Directory): readonly RepositoryFileNode[] {
		const folders = [...directory.folders.values()]
			.sort((left, right) => compareNames(left.name, right.name))
			.map((folder): RepositoryFileFolder => {
				const names = [folder.name];
				const paths = [folder.path];

				while (!folder.files.length && folder.folders.size === 1) {
					const child = folder.folders.values().next().value;

					if (!child) break;

					folder = child;
					names.push(folder.name);
					paths.push(folder.path);
				}

				return {
					kind: "folder",
					id: `folder:${folder.path}/`,
					path: folder.path,
					name: names.join("/"),
					paths,
					fileIds: folder.fileIds,
					children: RepositoryFileTree.children(folder),
				};
			});

		const files = directory.files
			.toSorted((left, right) =>
				compareNames(
					RepositoryFileTree.path(left),
					RepositoryFileTree.path(right)
				)
			)
			.map((entry): RepositoryFileNode => ({
				kind: "file",
				id: entry.id,
				entry,
			}));

		return [...folders, ...files];
	}

	static rows(
		nodes: readonly RepositoryFileNode[],
		collapsed: ReadonlySet<string>,
		matches?: ReadonlySet<string>
	): readonly RepositoryFileTreeRow[] {
		const rows: RepositoryFileTreeRow[] = [];

		const visit = (
			children: readonly RepositoryFileNode[],
			depth: number,
			parentId: string | null
		): void => {
			for (const node of children) {
				if (
					matches &&
					!(node.kind === "file"
						? matches.has(node.id)
						: node.fileIds.some((id) => matches.has(id)))
				)
					continue;

				rows.push({ ...node, depth, parentId });

				if (
					node.kind === "folder" &&
					(matches || !node.paths.some((path) => collapsed.has(path)))
				)
					visit(node.children, depth + 1, node.id);
			}
		};

		visit(nodes, 0, null);

		return rows;
	}

	static inclusion(
		ids: readonly string[],
		included: ReadonlySet<string>,
		partial: ReadonlySet<string>
	): boolean | "indeterminate" {
		let count = 0;
		let hasPartial = false;

		for (const id of ids) {
			if (included.has(id)) count++;

			if (partial.has(id)) hasPartial = true;
		}

		if (!count) return false;

		return count === ids.length && !hasPartial ? true : "indeterminate";
	}
}

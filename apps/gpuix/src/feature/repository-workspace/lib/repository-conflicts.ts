import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { GitRepository, type ResolveConflictInput } from "@1git/git";
import { ExternalEditors } from "../../editor-settings/external-editors";

/** Conflict preview and explicitly requested resolution; never continues Git operations. */
export class RepositoryConflicts {
	private constructor() {}

	static async read(root: string, path: string, signal: AbortSignal) {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const content = await opened.value.getFileContent({
			path,
			source: { kind: "working" },
			signal,
		});

		if (!content.ok) return content;

		const value = content.value;

		const supported =
			value.encoding === "utf8" &&
			!value.content.includes("\0") &&
			value.sizeBytes <= 512 * 1024;

		return {
			ok: true as const,
			value: supported
				? {
						text: value.content,
						hash: createHash("sha256").update(value.content).digest("hex"),
					}
				: null,
		};
	}

	static async write(root: string, request: ResolveConflictInput) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.resolveConflict(request);
	}

	/** Uses the app's external-editor preference, never a command from repository configuration. */
	static async openEditor(
		root: string,
		path: string,
		application?: string | null,
		editors = new ExternalEditors()
	): Promise<void> {
		const canonicalRoot = await realpath(root);
		const absolute = resolve(canonicalRoot, path);
		const local = relative(canonicalRoot, absolute);

		if (
			!local ||
			local.startsWith("../") ||
			local === ".." ||
			(await realpath(absolute)) !== absolute ||
			!(await stat(absolute)).isFile()
		)
			throw new Error(
				"Only regular files inside this repository can be opened here."
			);

		if (application === undefined) await editors.open(absolute);
		else await editors.open(absolute, application);
	}
}

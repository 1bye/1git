import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { promisify } from "node:util";
import { GitRepository, type ResolveConflictInput } from "@1git/git";

const execute = promisify(execFile);

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

	/** macOS text-editor association, not execution or a shell command from repository configuration. */
	static async openEditor(root: string, path: string): Promise<void> {
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

		if (process.platform !== "darwin")
			throw new Error("Open in editor currently requires macOS.");

		await execute("/usr/bin/open", ["-t", absolute], { timeout: 10_000 });
	}
}

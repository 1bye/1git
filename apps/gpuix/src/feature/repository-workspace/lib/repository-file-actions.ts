import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";
import { RepositoryConflicts } from "./repository-conflicts";

const execute = promisify(execFile);

/** Captured branch identity and exact paths for a confirmed discard batch. */
export interface FileDiscardRequest {
	kind: "discard";
	paths: readonly string[];
	expectedHead: string | null;
	expectedBranch: string | null;
}

/** macOS file actions and durable, path-scoped discard recovery. No shell interpolation. */
export class RepositoryFileActions {
	static async revealRecovery(directory: string) {
		await execute("/usr/bin/open", [directory], { timeout: 10_000 });
	}
	static async open(
		root: string,
		path: string,
		kind: "editor" | "finder" | "copy"
	) {
		if (kind === "editor")
			return await RepositoryConflicts.openEditor(root, path);

		if (kind === "copy") {
			const child = Bun.spawn(["/usr/bin/pbcopy"], {
				stdin: new TextEncoder().encode(path),
				stderr: "pipe",
			});

			if ((await child.exited) !== 0)
				throw new Error("Could not copy the path.");

			return;
		}

		const canonical = await realpath(root);
		const absolute = resolve(canonical, path);
		const local = relative(canonical, absolute);

		if (
			!local ||
			local === ".." ||
			local.startsWith("../") ||
			(await realpath(absolute)) !== absolute
		)
			throw new Error(
				"Only existing files inside the repository can be revealed."
			);

		await execute("/usr/bin/open", ["-R", absolute], { timeout: 10_000 });
	}

	static async discard(root: string, request: FileDiscardRequest) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const parent = join(
			homedir(),
			"Library",
			"Application Support",
			"1git-gpuix",
			"discard-recovery"
		);

		await mkdir(parent, { recursive: true, mode: 0o700 });
		const directory = join(parent, randomUUID());

		const result = await opened.value.discardFiles({
			paths: request.paths,
			allowDestructive: true,
			recovery: {
				directory,
				expectedHead: request.expectedHead,
				expectedBranch: request.expectedBranch,
			},
		});

		if (!result.ok)
			return {
				...result,
				error: {
					...result.error,
					message: `${result.error.message} Recovery files, if created, are at ${directory}.`,
				},
			};

		return {
			ok: true as const,
			value: result.value.snapshot,
			recoveryDirectory: directory,
		};
	}
}

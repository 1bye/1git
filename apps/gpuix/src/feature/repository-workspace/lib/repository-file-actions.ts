import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { GitRepository, type IgnoreFileInput } from "@1git/git";
import { RepositoryConflicts } from "./repository-conflicts";
import { NativeClipboard } from "../../../platform/clipboard";
import { ExternalEditors } from "../../editor-settings/external-editors";

const execute = promisify(execFile);

/** Captured branch identity and exact paths for a confirmed discard batch. */
export interface FileDiscardRequest {
	kind: "discard";
	paths: readonly string[];
	expectedHead: string | null;
	expectedBranch: string | null;
}

/** Reviewed file and branch for a confirmed .gitignore addition. */
export type FileIgnoreRequest = IgnoreFileInput & { kind: "ignore" };

/** macOS file actions and durable, path-scoped discard recovery. No shell interpolation. */
export class RepositoryFileActions {
	/** Reveal an existing repository folder without changing its contents. */
	static async revealRepository(directory: string) {
		const path = await realpath(directory);

		await execute("/usr/bin/open", ["-R", path], { timeout: 10_000 });
	}

	static async revealRecovery(directory: string) {
		await execute("/usr/bin/open", [directory], { timeout: 10_000 });
	}
	static async open(
		root: string,
		path: string | readonly string[],
		kind: "editor" | "finder" | "default" | "copy" | "copy-full",
		application?: string | null,
		editors?: ExternalEditors
	) {
		const requested = typeof path === "string" ? [path] : path;

		if (!requested.length) throw new Error("Choose a file.");

		if (kind === "editor") {
			if (requested.length !== 1 || !requested[0])
				throw new Error("Choose one file to open.");

			return await RepositoryConflicts.openEditor(
				root,
				requested[0],
				application,
				editors
			);
		}

		if (kind === "copy") {
			await NativeClipboard.write(requested.join("\n"));

			return;
		}

		const canonical = await realpath(root);

		const paths = requested.map((item) => resolve(canonical, item));

		for (const absolute of paths) {
			const local = relative(canonical, absolute);

			if (!local || local === ".." || local.startsWith("../"))
				throw new Error("File paths must stay inside the repository.");
		}

		if (kind === "copy-full") {
			await NativeClipboard.write(paths.join("\n"));

			return;
		}

		const absolute = paths[0];

		if (!absolute || paths.length !== 1)
			throw new Error("Choose one file to open.");

		if (
			(await realpath(absolute)) !== absolute ||
			!(await stat(absolute)).isFile()
		)
			throw new Error(
				"Only existing regular files inside the repository can be opened or revealed."
			);

		await execute(
			"/usr/bin/open",
			kind === "finder" ? ["-R", absolute] : [absolute],
			{ timeout: 10_000 }
		);
	}

	static async ignore(root: string, request: FileIgnoreRequest) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.ignoreFile(request);
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

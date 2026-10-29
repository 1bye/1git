import {
	installDirectory,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
} from "@1git/git/runtime";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { GitRepository, type GitResult } from "@1git/git";
import { LocalRepositoryWorktrees } from "../../workspace-tabs/lib/repository-worktrees-local";
import type { Accounts } from "../../accounts/lib/accounts";

import type {
	RepositorySetupRequest,
	RepositorySetupResult,
} from "./repository-setup";

/** Stages Git setup privately and installs into the checked destination without replacing user files. */
export class LocalRepositorySetup {
	private constructor() {}

	static folderName(remote: string): string {
		const path =
			remote
				.trim()
				.replace(/[\\/]+$/, "")
				.split(/[?#]/, 1)[0] ?? "";

		const name = basename(path)
			.replace(/\.git$/, "")
			.replace(/[^\p{L}\p{N}._-]+/gu, "-");

		return !name || name === "." || name === ".." ? "repository" : name;
	}

	static async write(
		request: RepositorySetupRequest,
		signal: AbortSignal,
		accounts?: Accounts
	): Promise<RepositorySetupResult> {
		let staging: string | undefined;
		let installing = false;

		try {
			if (!isAbsolute(request.path))
				return { ok: false, message: "Choose an absolute destination folder." };

			const destination = resolve(request.path);

			if (request.kind === "create") {
				const error = LocalRepositoryWorktrees.branchNameError(request.branch);

				if (!request.branch || error)
					return {
						ok: false,
						message: error ?? "Enter an initial branch name.",
					};
			}

			let exists = false;
			let identity: { dev: number; ino: number } | undefined;

			try {
				const stat = await lstat(destination);

				if (!stat.isDirectory() || stat.isSymbolicLink())
					return {
						ok: false,
						message: "Choose a regular folder, not a file or symbolic link.",
					};

				exists = true;
				identity = { dev: stat.dev, ino: stat.ino };
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;
			}

			{
				const opened = await GitRepository.open({
					path: exists ? destination : dirname(destination),
					signal,
				});

				if (opened.ok) {
					if (
						exists &&
						opened.value.info.root === (await realpath(destination))
					)
						return {
							ok: false,
							message: "This folder is already a repository.",
							openPath: opened.value.info.root,
						};

					return {
						ok: false,
						message: "Choose a folder outside the existing repository.",
					};
				}

				if (opened.error.code !== "not-a-repository")
					return { ok: false, message: opened.error.message };

				if (
					exists &&
					request.kind === "clone" &&
					(await readdir(destination)).length
				)
					return {
						ok: false,
						message: "Clone needs an empty folder. Choose another location.",
					};
			}

			if (signal.aborted)
				return {
					ok: false,
					message:
						"Operation cancelled. Review the destination before retrying.",
				};

			if (request.kind === "clone" && request.source && !accounts)
				return { ok: false, message: "Account cloning is unavailable." };

			if (!exists) {
				await mkdir(destination);
				const created = await lstat(destination);

				if (!created.isDirectory() || created.isSymbolicLink())
					throw new Error("The destination folder changed during setup.");

				identity = { dev: created.dev, ino: created.ino };
			}

			// Staying inside the destination needs no parent write access and keeps renames on one filesystem.
			staging = await mkdtemp(join(destination, ".1git-setup-"));
			const stagedDestination = await lstat(destination);

			if (
				!identity ||
				stagedDestination.isSymbolicLink() ||
				stagedDestination.dev !== identity.dev ||
				stagedDestination.ino !== identity.ino
			)
				throw new Error("The destination folder changed during setup.");

			const prepared = join(staging, "repository");
			let result: GitResult<GitRepository>;

			if (request.kind === "clone" && request.source && accounts) {
				try {
					result = await accounts.clone(
						request.source.account,
						request.source.repository,
						prepared,
						signal,
						true
					);
				} catch (cause) {
					return {
						ok: false,
						message: signal.aborted
							? "Operation cancelled. Review the destination before retrying."
							: cause instanceof Error
								? cause.message
								: "Account cloning failed. Check this account in Settings.",
					};
				}
			} else {
				result =
					request.kind === "clone"
						? await GitRepository.clone({
								path: prepared,
								requireExistingParent: true,
								remoteUrl: request.remoteUrl.trim(),
								signal,
							})
						: await GitRepository.initialize({
								path: prepared,
								requireExistingParent: true,
								initialBranch: request.branch,
								signal,
							});
			}

			if (!result.ok)
				return {
					ok: false,
					message: signal.aborted
						? "Operation cancelled. Review the destination before retrying."
						: result.error.message,
				};

			signal.throwIfAborted();

			if (!identity) throw new Error("The destination folder is unavailable.");

			installing = true;
			await installDirectory(prepared, destination, identity);
			const path = await realpath(destination);
			const installed = await lstat(path);

			if (
				installed.isSymbolicLink() ||
				installed.dev !== identity.dev ||
				installed.ino !== identity.ino
			)
				throw new Error("The destination folder changed during setup.");

			installing = false;

			return { ok: true, path };
		} catch {
			return {
				ok: false,
				message: installing
					? `The destination changed or could not be installed safely. Existing files were not replaced. Review the destination and remaining setup files at ${staging}.`
					: signal.aborted
						? "Operation cancelled. Review the destination before retrying."
						: "Could not prepare this folder. Check its location and permissions.",
			};
		} finally {
			if (staging && !installing)
				await rm(staging, { recursive: true, force: true });
		}
	}
}

import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { GitRepository } from "../../machines/repository-access";
import { RepositoryWorktrees } from "../../workspace-tabs/lib/repository-worktrees";
import type { Accounts } from "../../accounts/lib/accounts";
import type { SavedAccount } from "../../accounts/lib/account-store";
import type { RepositoryRef } from "@1git/hosting/contracts";

/** Explicit setup intent; selecting a destination alone never writes Git. */
export type RepositorySetupRequest =
	| {
			kind: "clone";
			path: string;
			remoteUrl: string;
			source?: { account: SavedAccount; repository: RepositoryRef };
	  }
	| { kind: "create"; path: string; branch: string };

/** Existing repositories require a separate Open action, never implicit reinitialization. */
export type RepositorySetupResult =
	| { ok: true; path: string }
	| { ok: false; message: string; openPath?: string };

/** Validates destinations and delegates setup to the existing Git boundary. Never deletes folders. */
export class RepositorySetup {
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
		try {
			if (!isAbsolute(request.path))
				return { ok: false, message: "Choose an absolute destination folder." };

			if (request.kind === "create") {
				const error = RepositoryWorktrees.branchNameError(request.branch);

				if (!request.branch || error)
					return {
						ok: false,
						message: error ?? "Enter an initial branch name.",
					};
			}

			let exists = false;

			try {
				const stat = await lstat(request.path);

				if (!stat.isDirectory() || stat.isSymbolicLink())
					return {
						ok: false,
						message: "Choose a regular folder, not a file or symbolic link.",
					};

				exists = true;
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
					path: exists ? request.path : dirname(request.path),
					signal,
				});

				if (opened.ok) {
					if (
						exists &&
						opened.value.info.root === (await realpath(request.path))
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
					(await readdir(request.path)).length
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

			if (request.kind === "clone" && request.source) {
				if (!accounts)
					return { ok: false, message: "Account cloning is unavailable." };

				try {
					const result = await accounts.clone(
						request.source.account,
						request.source.repository,
						request.path,
						signal
					);

					return result.ok
						? { ok: true, path: result.value.info.root }
						: {
								ok: false,
								message: signal.aborted
									? "Operation cancelled. Review the destination before retrying."
									: result.error.message,
							};
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
			}

			const result =
				request.kind === "clone"
					? await GitRepository.clone({
							path: request.path,
							remoteUrl: request.remoteUrl.trim(),
							signal,
						})
					: await GitRepository.initialize({
							path: request.path,
							initialBranch: request.branch,
							signal,
						});

			return result.ok
				? { ok: true, path: result.value.info.root }
				: {
						ok: false,
						message: signal.aborted
							? "Operation cancelled. Review the destination before retrying."
							: result.error.message,
					};
		} catch {
			return {
				ok: false,
				message:
					"Could not prepare this folder. Check its location and permissions.",
			};
		}
	}
}

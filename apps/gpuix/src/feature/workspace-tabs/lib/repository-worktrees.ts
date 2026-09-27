import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { GitRepository, type GitResult } from "@1git/git";
import { RepositoryBranches } from "./repository-branches";
const forbiddenBranchCharacters = /[~^:?*[\\]/;

/** Explicit destination and local-branch choice from the workspace menu. */
export interface WorktreeChoice {
	readonly kind: "new" | "existing" | "remote";
	readonly branch: string;
	readonly path: string;
}

/** Includes the source identity reviewed before starting the write. */
export interface WorktreeRequest extends WorktreeChoice {
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

/** Exact registered checkout reviewed in the removal confirmation. */
export interface WorktreeRemoval {
	readonly kind: "remove";
	readonly path: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

/** Creates a separate checkout without switching, stashing, or resetting the source worktree. */
export class RepositoryWorktrees {
	private constructor() {}

	/** Remove only a registered, clean linked worktree; never force or delete its branch. */
	static async remove(
		root: string,
		request: WorktreeRemoval
	): Promise<GitResult<string>> {
		const fail = (message: string): GitResult<never> => ({
			ok: false,
			error: {
				code: "conflict",
				operation: "remove-worktree",
				retryable: false,
				message,
			},
		});

		const source = await GitRepository.open({ path: root });

		if (!source.ok) return source;

		const worktrees = await source.value.getWorktrees();

		if (!worktrees.ok) return worktrees;

		const target = worktrees.value.find((item) => item.path === request.path);

		if (!target || target.locked || target.prunable)
			return fail(
				"Choose an available, unlocked worktree. Refresh before trying again."
			);

		if (
			target.headOid !== request.expectedHead ||
			target.branch !== request.expectedBranch
		)
			return fail(
				"The worktree changed since it was selected. Refresh before removing it."
			);

		try {
			if (
				!(await lstat(target.path)).isDirectory() ||
				(await realpath(target.path)) !== target.path
			)
				return fail("The worktree path changed. Nothing was removed.");
		} catch {
			return fail(
				"The worktree folder is unavailable. Refresh before trying again."
			);
		}

		const opened = await GitRepository.open({ path: target.path });

		if (!opened.ok) return opened;

		const snapshot = await opened.value.getSnapshot({ includeIgnored: true });
		const sourceSnapshot = await source.value.getSnapshot();

		if (!snapshot.ok) return snapshot;

		if (!sourceSnapshot.ok) return sourceSnapshot;

		const { repository, operationState, files } = snapshot.value;

		if (
			repository.root !== target.path ||
			snapshot.value.head.oid !== request.expectedHead ||
			snapshot.value.head.branch !== request.expectedBranch
		)
			return fail(
				"The worktree changed since it was selected. Refresh before removing it."
			);

		if (
			repository.commonDirectory !==
				sourceSnapshot.value.repository.commonDirectory ||
			repository.gitDirectory === repository.commonDirectory ||
			repository.root === sourceSnapshot.value.repository.root
		)
			return fail("The main or current worktree cannot be removed here.");

		if (
			operationState !== "normal" ||
			sourceSnapshot.value.operationState !== "normal"
		)
			return fail("Finish the Git operation before removing a worktree.");

		if (files.length)
			return fail(
				"This worktree contains changed, untracked, or ignored files. Nothing was removed."
			);

		const result = await source.value.removeWorktree({ path: target.path });

		return result.ok ? { ok: true, value: target.path } : result;
	}

	/** Immediate form feedback; Git remains the authoritative validator at creation time. */
	static branchNameError(name: string): string | null {
		if (!name) return null;

		if (
			name === "HEAD" ||
			name === "@" ||
			name.startsWith("-") ||
			name.endsWith(".") ||
			name.includes("..") ||
			name.includes("@{") ||
			forbiddenBranchCharacters.test(name) ||
			[...name].some(
				(character) =>
					character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
			) ||
			name
				.split("/")
				.some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
		)
			return "Enter a valid Git branch name.";

		return null;
	}

	static async create(
		root: string,
		request: WorktreeRequest
	): Promise<GitResult<string>> {
		const fail = (message: string): GitResult<never> => ({
			ok: false,
			error: {
				code: "conflict",
				operation: "create-worktree",
				retryable: false,
				message,
			},
		});

		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const snapshot = await opened.value.getSnapshot();

		if (!snapshot.ok) return snapshot;

		const { head, operationState } = snapshot.value;

		if (
			head.oid !== request.expectedHead ||
			head.branch !== request.expectedBranch
		)
			return fail(
				"The branch changed outside this app. Refresh before creating a worktree."
			);

		if (!head.oid || operationState !== "normal")
			return fail(
				"Create a commit and finish any Git operation before creating a worktree."
			);

		if (!isAbsolute(request.path))
			return fail("Choose an absolute destination path.");

		let path = "";

		try {
			path = join(
				await realpath(dirname(request.path)),
				basename(request.path)
			);
			const destination = await lstat(path);

			if (!destination.isDirectory() || (await readdir(path)).length > 0)
				return fail(
					"Choose an empty destination folder; nothing was overwritten."
				);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "ENOENT" ||
				!path
			)
				return fail(
					"Choose a writable empty folder or a new destination in an existing folder."
				);
		}

		const branches = await opened.value.getBranches();

		if (!branches.ok) return branches;

		const branch = branches.value.branches.find(
			(item) => item.type === "local" && item.name === request.branch
		);

		if (
			request.kind === "existing" &&
			(!branch || branch.checkedOut || branch.worktreePath)
		)
			return fail(
				"Choose a local branch that is not checked out in another worktree."
			);

		if (request.kind === "new" && branch)
			return fail("This branch already exists. Choose another name.");

		if (request.kind === "remote") {
			const remote = branches.value.branches.find(
				(item) => item.type === "remote" && item.fullName === request.branch
			);

			if (!remote)
				return fail("The remote branch is unavailable. Refresh and try again.");

			const target = RepositoryBranches.remoteTarget(remote, branches.value);

			if (target.error) return fail(target.error);

			const result = await opened.value.createWorktree({
				path,
				newBranch: target.name,
				revision: remote.fullName,
				track: true,
			});

			return result.ok ? { ok: true, value: path } : result;
		}

		const result = await opened.value.createWorktree({
			path,
			...(request.kind === "new"
				? { newBranch: request.branch, revision: head.oid }
				: { revision: request.branch }),
		});

		return result.ok ? { ok: true, value: path } : result;
	}
}

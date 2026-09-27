import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { GitRepository, type GitResult } from "@1git/git";
const forbiddenBranchCharacters = /[~^:?*[\\]/;

/** Explicit destination and local-branch choice from the workspace menu. */
export interface WorktreeChoice {
	readonly kind: "new" | "existing";
	readonly branch: string;
	readonly path: string;
}

/** Includes the source identity reviewed before starting the write. */
export interface WorktreeRequest extends WorktreeChoice {
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

/** Creates a separate checkout without switching, stashing, or resetting the source worktree. */
export class RepositoryWorktrees {
	private constructor() {}

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

		const result = await opened.value.createWorktree({
			path,
			...(request.kind === "new"
				? { newBranch: request.branch, revision: head.oid }
				: { revision: request.branch }),
		});

		return result.ok ? { ok: true, value: path } : result;
	}
}

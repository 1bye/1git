import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
	AddRemoteInput,
	BranchCollection,
	BranchMutationResult,
	ChangeHunkInput,
	ChangeHunkResult,
	CheckoutBranchInput,
	CloneRepositoryInput,
	CommitInfo,
	CommitInput,
	CommitPage,
	CommitResult,
	ConfigValue,
	CreateBranchInput,
	CreateTagInput,
	CreateWorktreeInput,
	DeleteBranchInput,
	DeleteTagInput,
	DiffInput,
	DiscardFilesInput,
	DiscardFilesResult,
	DropStashInput,
	FetchInput,
	FileChange,
	FileContent,
	FileContentInput,
	FileContentSource,
	FileDiff,
	GetConfigInput,
	GitCallOptions,
	GitOperation,
	GitResult,
	HistoryInput,
	InitializeRepositoryInput,
	LockWorktreeInput,
	MergeInput,
	MoveWorktreeInput,
	OpenRepositoryInput,
	PruneWorktreesInput,
	PullInput,
	PushInput,
	RebaseInput,
	RemoteInfo,
	RemoveRemoteInput,
	RemoveWorktreeInput,
	RenameBranchInput,
	RenameRemoteInput,
	RepairWorktreesInput,
	RepositoryInfo,
	RepositorySnapshot,
	ResetInput,
	RestoreInput,
	RevertInput,
	RevisionSequenceInput,
	SetConfigInput,
	SetRemoteUrlInput,
	SetUpstreamInput,
	SnapshotInput,
	StageInput,
	StashInfo,
	StashInput,
	StashReferenceInput,
	SyncResult,
	TagInfo,
	UndoDiscardInput,
	UnsetConfigInput,
	WorktreeInfo,
	WorktreePathInput,
} from "./contracts.js";
import { selectHunkPatch } from "./hunk-patch.js";
import type { RepositoryContext } from "./internal.js";
import {
	GitCommandFailure,
	GitProcess,
	type GitProcessOptions,
} from "./process/git-process.js";
import {
	loadBranches,
	loadCommit,
	loadDiff,
	loadFileContent,
	loadHistory,
	loadRemotes,
	loadSnapshot,
	loadStashes,
	loadTags,
	loadWorktrees,
} from "./queries.js";
import { fail, invalidInput, succeed, toGitError } from "./result.js";
import {
	requireConfigKey,
	requireConfigReadScope,
	requireConfigScope,
	requireCredentialFreeRemoteUrl,
	requireIntegerInRange,
	requireRepositoryPaths,
	requireRevision,
	requireText,
} from "./validation.js";

const EMPTY_HISTORY: CommitPage = {
	commits: [],
	hasMore: false,
	nextOffset: null,
};
const DEFAULT_HISTORY_LIMIT = 50;
const DISCARD_UNDO_TTL_MS = 15_000;
const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_DIFF_CONTEXT_LINES = 2_147_483_647;
const MAX_HISTORY_LIMIT = 500;
const MAX_HUNK_INDEX = 100_000;

interface PendingDiscardUndo {
	readonly expiresAt: number;
	readonly path: string;
	readonly stagedPatch: string;
	readonly token: string;
	readonly worktreePatch: string;
}

const matchesRequestedPath = (
	file: FileChange,
	requestedPaths: ReadonlySet<string>
): boolean =>
	requestedPaths.has(file.path) ||
	(file.originalPath !== undefined && requestedPaths.has(file.originalPath));

const capture = async <T>(
	operation: GitOperation,
	task: () => Promise<T>
): Promise<GitResult<T>> => {
	try {
		return succeed(await task());
	} catch (error: unknown) {
		return fail(toGitError(operation, error));
	}
};

const processOptions = (input: {
	readonly runtime?: GitProcessOptions;
}): GitProcessOptions => ({
	executable: input.runtime?.executable,
	maxOutputBytes: input.runtime?.maxOutputBytes,
});

const existingDirectory = async (path: string): Promise<string> => {
	const absolutePath = resolve(path);
	const pathStat = await stat(absolutePath);
	return await realpath(
		pathStat.isDirectory() ? absolutePath : dirname(absolutePath)
	);
};

const loadRepositoryInfo = async (
	process: GitProcess,
	path: string,
	signal?: AbortSignal
): Promise<RepositoryInfo> => {
	const cwd = await existingDirectory(path);
	const bareOutput = await process.run({
		args: ["rev-parse", "--is-bare-repository"],
		cwd,
		signal,
	});
	const isBare = bareOutput.stdout.toString("utf8").trim() === "true";
	if (isBare) {
		throw invalidInput(
			"open-repository",
			"Bare repositories do not have a working tree.",
			"bare-repository"
		);
	}
	const rootOutput = await process.run({
		args: ["rev-parse", "--show-toplevel"],
		cwd,
		signal,
	});
	const root = await realpath(rootOutput.stdout.toString("utf8").trim());
	const [gitDirectoryOutput, commonDirectoryOutput, shallowOutput] =
		await Promise.all([
			process.run({
				args: ["rev-parse", "--path-format=absolute", "--git-dir"],
				cwd: root,
				signal,
			}),
			process.run({
				args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
				cwd: root,
				signal,
			}),
			process.run({
				args: ["rev-parse", "--is-shallow-repository"],
				cwd: root,
				signal,
			}),
		]);
	return {
		commonDirectory: commonDirectoryOutput.stdout.toString("utf8").trim(),
		gitDirectory: gitDirectoryOutput.stdout.toString("utf8").trim(),
		isBare: false,
		isShallow: shallowOutput.stdout.toString("utf8").trim() === "true",
		root,
	};
};

const requireRemoteName = (name: string, operation: GitOperation): string =>
	requireRevision(name, "Remote name", operation);

const requireBranchName = async (
	context: RepositoryContext,
	name: string,
	operation: GitOperation,
	signal?: AbortSignal
): Promise<string> => {
	requireRevision(name, "Branch name", operation);
	await context.process.run({
		args: ["check-ref-format", "--branch", name],
		cwd: context.repository.root,
		signal,
	});
	return name;
};

const requireTagName = async (
	context: RepositoryContext,
	name: string,
	operation: GitOperation,
	signal?: AbortSignal
): Promise<string> => {
	requireRevision(name, "Tag name", operation);
	await context.process.run({
		args: ["check-ref-format", `refs/tags/${name}`],
		cwd: context.repository.root,
		signal,
	});
	return name;
};

const requireRevisions = (
	revisions: readonly string[],
	operation: GitOperation
): readonly string[] => {
	if (revisions.length === 0) {
		throw invalidInput(operation, "At least one revision is required.");
	}
	return revisions.map((revision) =>
		requireRevision(revision, "Revision", operation)
	);
};

const branchResult = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<BranchMutationResult> => {
	const [branches, snapshot] = await Promise.all([
		loadBranches(context, signal),
		loadSnapshot(context, false, signal),
	]);
	return { branches, snapshot };
};

const syncResult = async (
	context: RepositoryContext,
	operation: "fetch" | "pull" | "push",
	remote: string | null,
	signal?: AbortSignal
): Promise<SyncResult> => {
	const snapshot = await loadSnapshot(context, false, signal);
	return {
		branch: snapshot.head.branch,
		operation,
		remote,
		snapshot,
	};
};

/** Stateful repository facade that owns identity and serializes mutations. */
export class GitRepository {
	readonly info: RepositoryInfo;
	private readonly context: RepositoryContext;
	private mutationTail: Promise<void> = Promise.resolve();
	private pendingDiscardUndo: PendingDiscardUndo | null = null;

	private constructor(context: RepositoryContext) {
		this.context = context;
		this.info = context.repository;
	}

	/** Opens the repository containing the supplied directory or file path. */
	static async open(
		input: OpenRepositoryInput
	): Promise<GitResult<GitRepository>> {
		return await capture("open-repository", async () => {
			requireText(input.path, "Repository path", "open-repository");
			const process = new GitProcess(processOptions(input));
			const repository = await loadRepositoryInfo(
				process,
				input.path,
				input.signal
			);
			return new GitRepository({ process, repository });
		});
	}

	/** Initializes and opens a non-bare repository. */
	static async initialize(
		input: InitializeRepositoryInput
	): Promise<GitResult<GitRepository>> {
		return await capture("initialize-repository", async () => {
			requireText(input.path, "Repository path", "initialize-repository");
			const targetPath = resolve(input.path);
			await mkdir(dirname(targetPath), { recursive: true });
			const process = new GitProcess(processOptions(input));
			const args = ["init"];
			if (input.initialBranch) {
				requireRevision(
					input.initialBranch,
					"Initial branch",
					"initialize-repository"
				);
				args.push(`--initial-branch=${input.initialBranch}`);
			}
			args.push("--", targetPath);
			await process.run({
				args,
				cwd: dirname(targetPath),
				signal: input.signal,
			});
			const repository = await loadRepositoryInfo(
				process,
				targetPath,
				input.signal
			);
			return new GitRepository({ process, repository });
		});
	}

	/** Clones and opens a repository without interactive terminal prompts. */
	static async clone(
		input: CloneRepositoryInput
	): Promise<GitResult<GitRepository>> {
		return await capture("clone-repository", async () => {
			requireText(input.path, "Clone path", "clone-repository");
			requireCredentialFreeRemoteUrl(input.remoteUrl, "clone-repository");
			const targetPath = resolve(input.path);
			await mkdir(dirname(targetPath), { recursive: true });
			const process = new GitProcess(processOptions(input));
			const args = ["clone"];
			if (input.branch) {
				requireRevision(input.branch, "Branch", "clone-repository");
				args.push("--branch", input.branch);
			}
			if (input.depth !== undefined) {
				requireIntegerInRange(
					input.depth,
					"Clone depth",
					1,
					Number.MAX_SAFE_INTEGER,
					"clone-repository"
				);
				args.push(`--depth=${input.depth}`);
			}
			if (input.recurseSubmodules) {
				args.push("--recurse-submodules");
			}
			args.push("--", input.remoteUrl, targetPath);
			await process.run({
				args,
				cwd: dirname(targetPath),
				signal: input.signal,
			});
			const repository = await loadRepositoryInfo(
				process,
				targetPath,
				input.signal
			);
			return new GitRepository({ process, repository });
		});
	}

	/** Returns current HEAD, tracking, operation, stash, and path state. */
	async getSnapshot(
		input: SnapshotInput = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.read("get-snapshot", async () =>
			loadSnapshot(this.context, input.includeIgnored, input.signal)
		);
	}

	/** Returns a bounded page of commit history. */
	async getHistory(input: HistoryInput = {}): Promise<GitResult<CommitPage>> {
		return await this.read("get-history", async () => {
			const limit = requireIntegerInRange(
				input.limit ?? DEFAULT_HISTORY_LIMIT,
				"History limit",
				1,
				MAX_HISTORY_LIMIT,
				"get-history"
			);
			const offset = requireIntegerInRange(
				input.offset ?? 0,
				"History offset",
				0,
				Number.MAX_SAFE_INTEGER,
				"get-history"
			);
			const paths = input.paths
				? requireRepositoryPaths(input.paths, "get-history")
				: undefined;
			const revision = input.revision
				? requireRevision(input.revision, "Revision", "get-history")
				: undefined;
			const snapshot = await loadSnapshot(this.context, false, input.signal);
			if (snapshot.head.unborn) {
				return EMPTY_HISTORY;
			}
			return await loadHistory(this.context, {
				...input,
				limit,
				offset,
				paths,
				revision,
			});
		});
	}

	/** Returns metadata for one commit-ish. */
	async getCommit(
		revision: string,
		options: GitCallOptions = {}
	): Promise<GitResult<CommitInfo>> {
		return await this.read("get-commit", async () =>
			loadCommit(
				this.context,
				requireRevision(revision, "Revision", "get-commit"),
				options.signal
			)
		);
	}

	/** Returns local and remote-tracking branches. */
	async getBranches(
		options: GitCallOptions = {}
	): Promise<GitResult<BranchCollection>> {
		return await this.read("get-branches", async () =>
			loadBranches(this.context, options.signal)
		);
	}

	/** Returns all tags. */
	async getTags(
		options: GitCallOptions = {}
	): Promise<GitResult<readonly TagInfo[]>> {
		return await this.read("get-tags", async () =>
			loadTags(this.context, options.signal)
		);
	}

	/** Returns all remotes and their fetch/push URLs. */
	async getRemotes(
		options: GitCallOptions = {}
	): Promise<GitResult<readonly RemoteInfo[]>> {
		return await this.read("get-remotes", async () =>
			loadRemotes(this.context, options.signal)
		);
	}

	/** Returns stash entries newest first. */
	async getStashes(
		options: GitCallOptions = {}
	): Promise<GitResult<readonly StashInfo[]>> {
		return await this.read("get-stashes", async () =>
			loadStashes(this.context, options.signal)
		);
	}

	/** Returns all worktrees registered by the repository. */
	async getWorktrees(
		options: GitCallOptions = {}
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.read("get-worktrees", async () =>
			loadWorktrees(this.context, options.signal)
		);
	}

	/** Returns patch text and file statistics for a diff target. */
	async getDiff(input: DiffInput): Promise<GitResult<FileDiff>> {
		return await this.read("diff", async () => {
			const paths = input.paths
				? requireRepositoryPaths(input.paths, "diff")
				: undefined;
			const contextLines = requireIntegerInRange(
				input.contextLines ?? 3,
				"Context lines",
				0,
				MAX_DIFF_CONTEXT_LINES,
				"diff"
			);
			if (input.target.kind === "commit") {
				requireRevision(input.target.revision, "Revision", "diff");
			} else if (input.target.kind === "range") {
				requireRevision(input.target.base, "Base revision", "diff");
				requireRevision(input.target.head, "Head revision", "diff");
			}
			return await loadDiff(this.context, {
				...input,
				contextLines,
				paths,
			});
		});
	}

	/** Returns a file at a commit as UTF-8 or base64. */
	async getFileContent(
		input: FileContentInput
	): Promise<GitResult<FileContent>> {
		return await this.read("file-content", async () => {
			const requestedSource =
				input.source ??
				(input.revision
					? { kind: "revision", revision: input.revision }
					: null);
			if (!requestedSource) {
				throw invalidInput(
					"file-content",
					"A file content source is required."
				);
			}
			let source: FileContentSource;
			if (requestedSource.kind === "object") {
				source = {
					kind: "object",
					objectId: requireRevision(
						requestedSource.objectId,
						"Object ID",
						"file-content"
					),
				};
			} else if (requestedSource.kind === "revision") {
				source = {
					kind: "revision",
					revision: requireRevision(
						requestedSource.revision,
						"Revision",
						"file-content"
					),
				};
			} else {
				source = requestedSource;
			}
			return await loadFileContent(
				this.context,
				source,
				requireRepositoryPaths([input.path], "file-content")[0] ?? "",
				input.signal
			);
		});
	}

	/** Stages selected repository-relative paths. */
	async stage(input: StageInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("stage", input.signal, async () => {
			const paths = requireRepositoryPaths(input.paths, "stage");
			await this.run(["add", "--", ...paths], input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Stages, unstages, or discards one path-scoped diff hunk. */
	async changeHunk(
		input: ChangeHunkInput
	): Promise<GitResult<ChangeHunkResult>> {
		return await this.mutate("change-hunk", input.signal, async () => {
			const path = requireRepositoryPaths([input.path], "change-hunk")[0] ?? "";
			const hunkIndex = requireIntegerInRange(
				input.hunkIndex,
				"Hunk index",
				0,
				MAX_HUNK_INDEX,
				"change-hunk"
			);
			if (input.action === "discard" && !input.allowDestructive) {
				throw invalidInput(
					"change-hunk",
					"Discarding worktree content requires allowDestructive: true."
				);
			}

			const target =
				input.action === "unstage"
					? ({ kind: "staged" } as const)
					: ({ kind: "working" } as const);
			const diff = await loadDiff(this.context, {
				contextLines: 3,
				paths: [path],
				signal: input.signal,
				target,
			});
			const patch = selectHunkPatch(diff.patch, hunkIndex);
			const args = ["apply", "--recount", "--whitespace=nowarn"];
			if (input.action !== "discard") {
				args.push("--cached");
			}
			if (input.action !== "stage") {
				args.push("--reverse");
			}
			await this.context.process.run({
				args,
				cwd: this.info.root,
				signal: input.signal,
				stdin: patch,
			});
			const snapshot = await loadSnapshot(this.context, false, input.signal);
			if (input.action !== "discard") {
				return { snapshot, undo: null };
			}

			const expiresAt = Date.now() + DISCARD_UNDO_TTL_MS;
			const undo = {
				expiresAt: new Date(expiresAt).toISOString(),
				path,
				token: randomUUID(),
			};
			this.pendingDiscardUndo = {
				expiresAt,
				path,
				stagedPatch: "",
				token: undo.token,
				worktreePatch: patch,
			};
			return { snapshot, undo };
		});
	}

	/** Discards all staged and unstaged changes for selected paths. */
	async discardFiles(
		input: DiscardFilesInput
	): Promise<GitResult<DiscardFilesResult>> {
		return await this.mutate("discard-files", input.signal, async () => {
			if (!input.allowDestructive) {
				throw invalidInput(
					"discard-files",
					"Discarding file changes requires allowDestructive: true."
				);
			}
			const requestedPaths = requireRepositoryPaths(
				input.paths,
				"discard-files"
			);
			const before = await loadSnapshot(this.context, false, input.signal);
			const requestedPathSet = new Set(requestedPaths);
			const selectedFiles = before.files.filter((file) =>
				matchesRequestedPath(file, requestedPathSet)
			);
			if (selectedFiles.length === 0) {
				throw invalidInput(
					"discard-files",
					"No changed file matches the selected path."
				);
			}
			if (selectedFiles.some((file) => file.recordType === "unmerged")) {
				throw invalidInput(
					"discard-files",
					"Resolve conflicted files before discarding their changes."
				);
			}

			const affectedPaths = [
				...new Set(
					selectedFiles.flatMap((file) =>
						file.originalPath ? [file.originalPath, file.path] : [file.path]
					)
				),
			];
			const stagedPatch = await this.captureDiffPatch(
				[
					"diff",
					"--cached",
					"--no-ext-diff",
					"--no-color",
					"--binary",
					"--full-index",
					before.head.unborn ? EMPTY_TREE_OID : "HEAD",
					"--",
					...affectedPaths,
				],
				input.signal
			);
			const trackedWorktreePatch = await this.captureDiffPatch(
				[
					"diff",
					"--no-ext-diff",
					"--no-color",
					"--binary",
					"--full-index",
					"--",
					...affectedPaths,
				],
				input.signal
			);
			const untrackedPatches = await Promise.all(
				selectedFiles
					.filter((file) => file.recordType === "untracked")
					.map((file) => this.captureNoIndexPatch(file.path, input.signal))
			);
			const worktreePatch = [trackedWorktreePatch, ...untrackedPatches]
				.filter(Boolean)
				.join("\n");
			if (!(stagedPatch || worktreePatch)) {
				throw invalidInput(
					"discard-files",
					"The selected file has no discardable changes."
				);
			}

			await this.applyPatch(worktreePatch, {
				reverse: true,
				signal: input.signal,
			});
			try {
				await this.applyPatch(stagedPatch, {
					reverse: true,
					signal: input.signal,
				});
				try {
					await this.applyPatch(stagedPatch, {
						cached: true,
						reverse: true,
						signal: input.signal,
					});
				} catch (error: unknown) {
					await this.applyPatch(stagedPatch, { signal: input.signal });
					throw error;
				}
			} catch (error: unknown) {
				await this.applyPatch(worktreePatch, { signal: input.signal });
				throw error;
			}

			const expiresAt = Date.now() + DISCARD_UNDO_TTL_MS;
			const undo = {
				expiresAt: new Date(expiresAt).toISOString(),
				path: selectedFiles[0]?.path ?? requestedPaths[0] ?? "",
				token: randomUUID(),
			};
			this.pendingDiscardUndo = {
				expiresAt,
				path: undo.path,
				stagedPatch,
				token: undo.token,
				worktreePatch,
			};
			return {
				snapshot: await loadSnapshot(this.context, false, input.signal),
				undo,
			};
		});
	}

	/** Restores the latest discarded change while its token is valid. */
	async undoDiscard(
		input: UndoDiscardInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("undo-discard", input.signal, async () => {
			const token = requireText(
				input.token,
				"Discard undo token",
				"undo-discard"
			);
			const pendingUndo = this.pendingDiscardUndo;
			if (
				!pendingUndo ||
				pendingUndo.token !== token ||
				pendingUndo.expiresAt <= Date.now()
			) {
				if (pendingUndo?.token === token) {
					this.pendingDiscardUndo = null;
				}
				throw invalidInput(
					"undo-discard",
					"The discarded change can no longer be restored."
				);
			}

			await this.applyPatch(pendingUndo.stagedPatch, {
				cached: true,
				signal: input.signal,
			});
			try {
				await this.applyPatch(pendingUndo.stagedPatch, {
					signal: input.signal,
				});
				try {
					await this.applyPatch(pendingUndo.worktreePatch, {
						signal: input.signal,
					});
				} catch (error: unknown) {
					await this.applyPatch(pendingUndo.stagedPatch, {
						reverse: true,
						signal: input.signal,
					});
					throw error;
				}
			} catch (error: unknown) {
				await this.applyPatch(pendingUndo.stagedPatch, {
					cached: true,
					reverse: true,
					signal: input.signal,
				});
				throw error;
			}
			this.pendingDiscardUndo = null;
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Stages all tracked and untracked changes. */
	async stageAll(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("stage-all", options.signal, async () => {
			await this.run(["add", "--all"], options.signal);
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	/** Removes selected paths from the index while preserving worktree content. */
	async unstage(input: StageInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("unstage", input.signal, async () => {
			const paths = requireRepositoryPaths(input.paths, "unstage");
			const snapshot = await loadSnapshot(this.context, false, input.signal);
			if (snapshot.head.unborn) {
				await this.run(
					["rm", "--cached", "--ignore-unmatch", "--", ...paths],
					input.signal
				);
			} else {
				await this.run(["restore", "--staged", "--", ...paths], input.signal);
			}
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Removes every path from the index while preserving worktree content. */
	async unstageAll(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("unstage-all", options.signal, async () => {
			const snapshot = await loadSnapshot(this.context, false, options.signal);
			if (snapshot.head.unborn) {
				await this.run(
					["rm", "-r", "--cached", "--ignore-unmatch", "--", "."],
					options.signal
				);
			} else {
				await this.run(["restore", "--staged", "--", ":/"], options.signal);
			}
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	/** Restores index or worktree paths; worktree changes require explicit consent. */
	async restore(input: RestoreInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("restore", input.signal, async () => {
			const paths = requireRepositoryPaths(input.paths, "restore");
			const restoreWorktree = input.worktree ?? !input.staged;
			if (restoreWorktree && !input.allowDestructive) {
				throw invalidInput(
					"restore",
					"Restoring worktree content requires allowDestructive: true."
				);
			}
			const args = ["restore"];
			if (input.source) {
				args.push(
					`--source=${requireRevision(input.source, "Source", "restore")}`
				);
			}
			if (input.staged) {
				args.push("--staged");
			}
			if (restoreWorktree) {
				args.push("--worktree");
			}
			args.push("--", ...paths);
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Resets HEAD/index/worktree; hard reset requires explicit consent. */
	async reset(input: ResetInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("reset", input.signal, async () => {
			if (input.mode === "hard" && !input.allowDestructive) {
				throw invalidInput(
					"reset",
					"Hard reset requires allowDestructive: true."
				);
			}
			const target = requireRevision(
				input.target ?? "HEAD",
				"Reset target",
				"reset"
			);
			await this.run(["reset", `--${input.mode}`, target], input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Creates a commit from the current index. */
	async commit(input: CommitInput): Promise<GitResult<CommitResult>> {
		return await this.mutate("commit", input.signal, async () => {
			const summary = requireText(input.summary.trim(), "Summary", "commit");
			const description = input.description?.trim() ?? "";
			if (description.includes("\0")) {
				throw invalidInput("commit", "Description must contain no NUL.");
			}
			const args = ["commit", "-F", "-"];
			if (input.allowEmpty) {
				args.push("--allow-empty");
			}
			if (input.amend) {
				args.push("--amend");
			}
			if (input.noVerify) {
				args.push("--no-verify");
			}
			if (input.signoff) {
				args.push("--signoff");
			}
			const message =
				description.length > 0
					? `${summary}\n\n${description}\n`
					: `${summary}\n`;
			await this.context.process.run({
				args,
				cwd: this.info.root,
				signal: input.signal,
				stdin: message,
			});
			const [commit, snapshot] = await Promise.all([
				loadCommit(this.context, "HEAD", input.signal),
				loadSnapshot(this.context, false, input.signal),
			]);
			return { commit, snapshot };
		});
	}

	/** Creates a branch, optionally switching to it. */
	async createBranch(
		input: CreateBranchInput
	): Promise<GitResult<BranchMutationResult>> {
		return await this.mutate("create-branch", input.signal, async () => {
			const name = await requireBranchName(
				this.context,
				input.name,
				"create-branch",
				input.signal
			);
			const args = input.checkout ? ["switch"] : ["branch"];
			if (input.force) {
				args.push(input.checkout ? "-C" : "--force");
			} else if (input.checkout) {
				args.push("-c");
			}
			args.push(name);
			if (input.startPoint) {
				args.push(
					requireRevision(input.startPoint, "Start point", "create-branch")
				);
			}
			await this.run(args, input.signal);
			return await branchResult(this.context, input.signal);
		});
	}

	/** Switches the current worktree to an existing branch. */
	async checkoutBranch(
		input: CheckoutBranchInput
	): Promise<GitResult<BranchMutationResult>> {
		return await this.mutate("checkout-branch", input.signal, async () => {
			const name = await requireBranchName(
				this.context,
				input.name,
				"checkout-branch",
				input.signal
			);
			const args = ["switch"];
			if (input.force) {
				args.push("--discard-changes");
			}
			args.push("--", name);
			await this.run(args, input.signal);
			return await branchResult(this.context, input.signal);
		});
	}

	/** Renames the current or named local branch. */
	async renameBranch(
		input: RenameBranchInput
	): Promise<GitResult<BranchMutationResult>> {
		return await this.mutate("rename-branch", input.signal, async () => {
			const newName = await requireBranchName(
				this.context,
				input.newName,
				"rename-branch",
				input.signal
			);
			const args = ["branch", input.force ? "-M" : "-m"];
			if (input.currentName) {
				args.push(
					await requireBranchName(
						this.context,
						input.currentName,
						"rename-branch",
						input.signal
					)
				);
			}
			args.push(newName);
			await this.run(args, input.signal);
			return await branchResult(this.context, input.signal);
		});
	}

	/** Deletes a local branch, requiring force for unmerged work. */
	async deleteBranch(
		input: DeleteBranchInput
	): Promise<GitResult<BranchMutationResult>> {
		return await this.mutate("delete-branch", input.signal, async () => {
			const name = await requireBranchName(
				this.context,
				input.name,
				"delete-branch",
				input.signal
			);
			await this.run(
				["branch", input.force ? "-D" : "-d", "--", name],
				input.signal
			);
			return await branchResult(this.context, input.signal);
		});
	}

	/** Sets the upstream branch used for tracking and synchronization. */
	async setUpstream(
		input: SetUpstreamInput
	): Promise<GitResult<BranchMutationResult>> {
		return await this.mutate("set-upstream", input.signal, async () => {
			const upstream = requireRevision(
				input.upstream,
				"Upstream",
				"set-upstream"
			);
			const args = ["branch", `--set-upstream-to=${upstream}`];
			if (input.branch) {
				args.push(
					await requireBranchName(
						this.context,
						input.branch,
						"set-upstream",
						input.signal
					)
				);
			}
			await this.run(args, input.signal);
			return await branchResult(this.context, input.signal);
		});
	}

	/** Merges one revision into the current branch. */
	async merge(input: MergeInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("merge", input.signal, async () => {
			const args = ["merge", "--no-edit"];
			if (input.fastForward === "only") {
				args.push("--ff-only");
			} else if (input.fastForward === "prevent") {
				args.push("--no-ff");
			}
			if (input.squash) {
				args.push("--squash");
			}
			if (input.message) {
				args.push("-m", requireText(input.message, "Merge message", "merge"));
			}
			args.push(requireRevision(input.revision, "Revision", "merge"));
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Aborts an in-progress merge. */
	async abortMerge(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("abort-merge", options.signal, async () => {
			await this.run(["merge", "--abort"], options.signal);
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	/** Continues an in-progress merge after conflicts are resolved. */
	async continueMerge(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("continue-merge", options.signal, async () => {
			await this.run(["merge", "--continue"], options.signal);
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	/** Rebases a branch onto an upstream, optionally through an explicit `onto`. */
	async rebase(input: RebaseInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("rebase", input.signal, async () => {
			const args = ["rebase"];
			if (input.autosquash) {
				args.push("--autosquash");
			}
			if (input.onto) {
				args.push(
					"--onto",
					requireRevision(input.onto, "Onto revision", "rebase")
				);
			}
			args.push(requireRevision(input.upstream, "Upstream", "rebase"));
			if (input.branch) {
				args.push(requireRevision(input.branch, "Branch", "rebase"));
			}
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Continues an in-progress rebase after conflicts are resolved. */
	async continueRebase(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.rebaseAction("continue-rebase", "--continue", options);
	}

	/** Skips the current commit in an in-progress rebase. */
	async skipRebase(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.rebaseAction("skip-rebase", "--skip", options);
	}

	/** Aborts an in-progress rebase. */
	async abortRebase(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.rebaseAction("abort-rebase", "--abort", options);
	}

	/** Applies one or more commits to the current branch. */
	async cherryPick(
		input: RevisionSequenceInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("cherry-pick", input.signal, async () => {
			await this.run(
				["cherry-pick", ...requireRevisions(input.revisions, "cherry-pick")],
				input.signal
			);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	async continueCherryPick(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.sequenceAction(
			"continue-cherry-pick",
			"cherry-pick",
			"--continue",
			options
		);
	}

	async abortCherryPick(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.sequenceAction(
			"abort-cherry-pick",
			"cherry-pick",
			"--abort",
			options
		);
	}

	/** Reverts one or more commits. */
	async revert(input: RevertInput): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("revert", input.signal, async () => {
			const args = ["revert", "--no-edit"];
			if (input.noCommit) {
				args.push("--no-commit");
			}
			args.push(...requireRevisions(input.revisions, "revert"));
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	async continueRevert(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.sequenceAction(
			"continue-revert",
			"revert",
			"--continue",
			options
		);
	}

	async abortRevert(
		options: GitCallOptions = {}
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.sequenceAction(
			"abort-revert",
			"revert",
			"--abort",
			options
		);
	}

	/** Creates a lightweight or annotated tag. */
	async createTag(
		input: CreateTagInput
	): Promise<GitResult<readonly TagInfo[]>> {
		return await this.mutate("create-tag", input.signal, async () => {
			const name = await requireTagName(
				this.context,
				input.name,
				"create-tag",
				input.signal
			);
			const args = ["tag"];
			if (input.force) {
				args.push("--force");
			}
			if (input.message !== undefined) {
				args.push(
					"-a",
					"-m",
					requireText(input.message, "Tag message", "create-tag")
				);
			}
			args.push(name);
			if (input.revision) {
				args.push(
					requireRevision(input.revision, "Tag revision", "create-tag")
				);
			}
			await this.run(args, input.signal);
			return await loadTags(this.context, input.signal);
		});
	}

	/** Deletes a local tag. */
	async deleteTag(
		input: DeleteTagInput
	): Promise<GitResult<readonly TagInfo[]>> {
		return await this.mutate("delete-tag", input.signal, async () => {
			const name = await requireTagName(
				this.context,
				input.name,
				"delete-tag",
				input.signal
			);
			await this.run(["tag", "--delete", "--", name], input.signal);
			return await loadTags(this.context, input.signal);
		});
	}

	/** Adds a named remote. */
	async addRemote(
		input: AddRemoteInput
	): Promise<GitResult<readonly RemoteInfo[]>> {
		return await this.mutate("add-remote", input.signal, async () => {
			const name = requireRemoteName(input.name, "add-remote");
			const url = requireCredentialFreeRemoteUrl(input.url, "add-remote");
			const args = ["remote", "add"];
			if (input.fetch) {
				args.push("-f");
			}
			args.push("--", name, url);
			await this.run(args, input.signal);
			return await loadRemotes(this.context, input.signal);
		});
	}

	/** Renames a remote and associated tracking refs/config. */
	async renameRemote(
		input: RenameRemoteInput
	): Promise<GitResult<readonly RemoteInfo[]>> {
		return await this.mutate("rename-remote", input.signal, async () => {
			const currentName = requireRemoteName(input.currentName, "rename-remote");
			const newName = requireRemoteName(input.newName, "rename-remote");
			await this.run(["remote", "rename", currentName, newName], input.signal);
			return await loadRemotes(this.context, input.signal);
		});
	}

	/** Sets or adds a remote fetch/push URL. */
	async setRemoteUrl(
		input: SetRemoteUrlInput
	): Promise<GitResult<readonly RemoteInfo[]>> {
		return await this.mutate("set-remote-url", input.signal, async () => {
			const name = requireRemoteName(input.name, "set-remote-url");
			const url = requireCredentialFreeRemoteUrl(input.url, "set-remote-url");
			const args = ["remote", "set-url"];
			if (input.push) {
				args.push("--push");
			}
			if (input.add) {
				args.push("--add");
			}
			args.push(name, url);
			await this.run(args, input.signal);
			return await loadRemotes(this.context, input.signal);
		});
	}

	/** Removes a remote and associated tracking configuration. */
	async removeRemote(
		input: RemoveRemoteInput
	): Promise<GitResult<readonly RemoteInfo[]>> {
		return await this.mutate("remove-remote", input.signal, async () => {
			const name = requireRemoteName(input.name, "remove-remote");
			await this.run(["remote", "remove", name], input.signal);
			return await loadRemotes(this.context, input.signal);
		});
	}

	/** Fetches refs and updates ahead/behind state. */
	async fetch(input: FetchInput = {}): Promise<GitResult<SyncResult>> {
		return await this.mutate("fetch", input.signal, async () => {
			const args = ["fetch"];
			if (input.prune) {
				args.push("--prune");
			}
			if (input.tags) {
				args.push("--tags");
			}
			const remote = input.remote
				? requireRemoteName(input.remote, "fetch")
				: null;
			if (remote) {
				args.push(remote);
			} else {
				args.push("--all");
			}
			await this.run(args, input.signal);
			return await syncResult(this.context, "fetch", remote, input.signal);
		});
	}

	/** Pulls from an upstream using an explicit integration strategy. */
	async pull(input: PullInput = {}): Promise<GitResult<SyncResult>> {
		return await this.mutate("pull", input.signal, async () => {
			const args = ["pull"];
			const strategy = input.strategy ?? "fast-forward-only";
			if (strategy === "fast-forward-only") {
				args.push("--ff-only");
			} else if (strategy === "rebase") {
				args.push("--rebase");
			} else {
				args.push("--no-rebase");
			}
			const remote = input.remote
				? requireRemoteName(input.remote, "pull")
				: null;
			if (remote) {
				args.push(remote);
				if (input.branch) {
					args.push(requireRevision(input.branch, "Branch", "pull"));
				}
			} else if (input.branch) {
				throw invalidInput("pull", "A branch requires an explicit remote.");
			}
			await this.run(args, input.signal);
			return await syncResult(this.context, "pull", remote, input.signal);
		});
	}

	/** Pushes the current or selected branch. */
	async push(input: PushInput = {}): Promise<GitResult<SyncResult>> {
		return await this.mutate("push", input.signal, async () => {
			const args = ["push"];
			if (input.forceWithLease) {
				args.push("--force-with-lease");
			}
			if (input.tags) {
				args.push("--tags");
			}
			if (input.setUpstream) {
				args.push("--set-upstream");
			}
			const remote = input.remote
				? requireRemoteName(input.remote, "push")
				: null;
			if (remote) {
				args.push(remote);
				if (input.branch) {
					args.push(requireRevision(input.branch, "Branch", "push"));
				}
			} else if (input.branch || input.setUpstream) {
				throw invalidInput(
					"push",
					"A branch or setUpstream requires an explicit remote."
				);
			}
			await this.run(args, input.signal);
			return await syncResult(this.context, "push", remote, input.signal);
		});
	}

	/** Saves working changes to a new stash entry. */
	async stash(input: StashInput = {}): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("stash", input.signal, async () => {
			const args = ["stash", "push"];
			if (input.includeUntracked) {
				args.push("--include-untracked");
			}
			if (input.keepIndex) {
				args.push("--keep-index");
			}
			if (input.staged) {
				args.push("--staged");
			}
			if (input.message) {
				args.push("-m", requireText(input.message, "Stash message", "stash"));
			}
			if (input.paths) {
				args.push("--", ...requireRepositoryPaths(input.paths, "stash"));
			}
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}

	/** Applies a stash without removing it. */
	async applyStash(
		input: StashReferenceInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.stashApplyAction("apply-stash", "apply", input);
	}

	/** Applies and removes a stash. */
	async popStash(
		input: StashReferenceInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.stashApplyAction("pop-stash", "pop", input);
	}

	/** Removes one stash entry. */
	async dropStash(
		input: DropStashInput
	): Promise<GitResult<readonly StashInfo[]>> {
		return await this.mutate("drop-stash", input.signal, async () => {
			const reference = requireRevision(
				input.reference,
				"Stash reference",
				"drop-stash"
			);
			await this.run(["stash", "drop", reference], input.signal);
			return await loadStashes(this.context, input.signal);
		});
	}

	/** Creates a linked worktree, optionally with a new branch. */
	async createWorktree(
		input: CreateWorktreeInput
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("create-worktree", input.signal, async () => {
			if (input.detach && input.newBranch) {
				throw invalidInput(
					"create-worktree",
					"detach and newBranch are mutually exclusive."
				);
			}
			const args = ["worktree", "add"];
			if (input.force) {
				args.push("--force");
			}
			if (input.detach) {
				args.push("--detach");
			}
			if (input.newBranch) {
				args.push(
					"-b",
					await requireBranchName(
						this.context,
						input.newBranch,
						"create-worktree",
						input.signal
					)
				);
			}
			if (input.lockReason !== undefined) {
				args.push(
					"--lock",
					"--reason",
					requireText(input.lockReason, "Lock reason", "create-worktree")
				);
			}
			args.push(resolve(input.path));
			if (input.revision) {
				args.push(
					requireRevision(input.revision, "Revision", "create-worktree")
				);
			}
			await this.run(args, input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Moves a linked worktree to a new absolute path. */
	async moveWorktree(
		input: MoveWorktreeInput
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("move-worktree", input.signal, async () => {
			await this.run(
				["worktree", "move", resolve(input.path), resolve(input.newPath)],
				input.signal
			);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Removes a linked worktree. */
	async removeWorktree(
		input: RemoveWorktreeInput
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("remove-worktree", input.signal, async () => {
			const args = ["worktree", "remove"];
			if (input.force) {
				args.push("--force");
			}
			args.push(resolve(input.path));
			await this.run(args, input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Prevents automatic pruning of a worktree. */
	async lockWorktree(
		input: LockWorktreeInput
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("lock-worktree", input.signal, async () => {
			const args = ["worktree", "lock"];
			if (input.reason) {
				args.push(
					"--reason",
					requireText(input.reason, "Lock reason", "lock-worktree")
				);
			}
			args.push(resolve(input.path));
			await this.run(args, input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Unlocks a worktree. */
	async unlockWorktree(
		input: WorktreePathInput
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("unlock-worktree", input.signal, async () => {
			await this.run(["worktree", "unlock", resolve(input.path)], input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Prunes stale worktree metadata. */
	async pruneWorktrees(
		input: PruneWorktreesInput = {}
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("prune-worktrees", input.signal, async () => {
			const args = ["worktree", "prune"];
			if (input.expire) {
				args.push(
					`--expire=${requireText(input.expire, "Expiry", "prune-worktrees")}`
				);
			}
			await this.run(args, input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Repairs worktree administrative links after manual moves. */
	async repairWorktrees(
		input: RepairWorktreesInput = {}
	): Promise<GitResult<readonly WorktreeInfo[]>> {
		return await this.mutate("repair-worktrees", input.signal, async () => {
			const paths = input.paths?.map((path) => resolve(path)) ?? [];
			await this.run(["worktree", "repair", ...paths], input.signal);
			return await loadWorktrees(this.context, input.signal);
		});
	}

	/** Reads an effective, local, or worktree-specific configuration value. */
	async getConfig(input: GetConfigInput): Promise<GitResult<ConfigValue>> {
		return await this.read("get-config", async () => {
			const key = requireConfigKey(input.key, "get-config");
			const scope = requireConfigReadScope(
				input.scope ?? "local",
				"get-config"
			);
			try {
				const output = await this.context.process.run({
					args:
						scope === "effective"
							? ["config", "--get", key]
							: ["config", `--${scope}`, "--get", key],
					cwd: this.info.root,
					signal: input.signal,
				});
				return {
					key,
					scope,
					value: output.stdout.toString("utf8").trimEnd(),
				};
			} catch (error: unknown) {
				if (error instanceof GitCommandFailure && error.exitCode === 1) {
					return { key, scope, value: null };
				}
				throw error;
			}
		});
	}

	/** Writes a local or worktree-specific configuration value. */
	async setConfig(input: SetConfigInput): Promise<GitResult<ConfigValue>> {
		return await this.mutate("set-config", input.signal, async () => {
			const key = requireConfigKey(input.key, "set-config");
			const value = requireText(
				input.value,
				"Configuration value",
				"set-config"
			);
			const scope = requireConfigScope(input.scope ?? "local", "set-config");
			await this.run(["config", `--${scope}`, key, value], input.signal);
			return { key, scope, value };
		});
	}

	/** Removes all matching local or worktree-specific configuration values. */
	async unsetConfig(input: UnsetConfigInput): Promise<GitResult<ConfigValue>> {
		return await this.mutate("unset-config", input.signal, async () => {
			const key = requireConfigKey(input.key, "unset-config");
			const scope = requireConfigScope(input.scope ?? "local", "unset-config");
			try {
				await this.run(
					["config", `--${scope}`, "--unset-all", key],
					input.signal
				);
			} catch (error: unknown) {
				if (!(error instanceof GitCommandFailure && error.exitCode === 5)) {
					throw error;
				}
			}
			return { key, scope, value: null };
		});
	}

	private async read<T>(
		operation: GitOperation,
		task: () => Promise<T>
	): Promise<GitResult<T>> {
		const pendingMutation = this.mutationTail;
		await pendingMutation;
		return await capture(operation, task);
	}

	private async mutate<T>(
		operation: GitOperation,
		signal: AbortSignal | undefined,
		task: () => Promise<T>
	): Promise<GitResult<T>> {
		const previousMutation = this.mutationTail;
		const gate = Promise.withResolvers<void>();
		this.mutationTail = gate.promise;
		await previousMutation;
		if (signal?.aborted) {
			gate.resolve();
			return fail({
				code: "aborted",
				message: "Git operation was aborted.",
				operation,
				retryable: false,
			});
		}
		try {
			return await capture(operation, task);
		} finally {
			gate.resolve();
		}
	}

	private async applyPatch(
		patch: string,
		options: {
			readonly cached?: boolean;
			readonly reverse?: boolean;
			readonly signal?: AbortSignal;
		}
	): Promise<void> {
		if (!patch) {
			return;
		}
		const args = ["apply", "--recount", "--whitespace=nowarn"];
		if (options.cached) {
			args.push("--cached");
		}
		if (options.reverse) {
			args.push("--reverse");
		}
		await this.context.process.run({
			args,
			cwd: this.info.root,
			signal: options.signal,
			stdin: patch,
		});
	}

	private async captureDiffPatch(
		args: readonly string[],
		signal?: AbortSignal
	): Promise<string> {
		const output = await this.context.process.run({
			args,
			cwd: this.info.root,
			signal,
		});
		return output.stdout.toString("utf8");
	}

	private async captureNoIndexPatch(
		path: string,
		signal?: AbortSignal
	): Promise<string> {
		try {
			return await this.captureDiffPatch(
				[
					"diff",
					"--no-index",
					"--no-ext-diff",
					"--no-color",
					"--binary",
					"--full-index",
					"--",
					"/dev/null",
					path,
				],
				signal
			);
		} catch (error: unknown) {
			if (error instanceof GitCommandFailure && error.exitCode === 1) {
				return error.stdout ? `${error.stdout}\n` : "";
			}
			throw error;
		}
	}

	private async run(
		args: readonly string[],
		signal?: AbortSignal
	): Promise<void> {
		await this.context.process.run({
			args,
			cwd: this.info.root,
			signal,
		});
	}

	private async rebaseAction(
		operation: "abort-rebase" | "continue-rebase" | "skip-rebase",
		action: "--abort" | "--continue" | "--skip",
		options: GitCallOptions
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate(operation, options.signal, async () => {
			await this.run(["rebase", action], options.signal);
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	private async sequenceAction(
		operation:
			| "abort-cherry-pick"
			| "abort-revert"
			| "continue-cherry-pick"
			| "continue-revert",
		command: "cherry-pick" | "revert",
		action: "--abort" | "--continue",
		options: GitCallOptions
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate(operation, options.signal, async () => {
			await this.run([command, action], options.signal);
			return await loadSnapshot(this.context, false, options.signal);
		});
	}

	private async stashApplyAction(
		operation: "apply-stash" | "pop-stash",
		action: "apply" | "pop",
		input: StashReferenceInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate(operation, input.signal, async () => {
			const args = ["stash", action];
			if (input.reinstateIndex) {
				args.push("--index");
			}
			args.push(requireRevision(input.reference, "Stash reference", operation));
			await this.run(args, input.signal);
			return await loadSnapshot(this.context, false, input.signal);
		});
	}
}

export type * from "./contracts.js";

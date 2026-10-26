import { createHash, randomUUID } from "node:crypto";
export { GitIdentity, type GitIdentityValues } from "./identity.js";
export { GitIgnore } from "./ignore.js";
export { PartialPatch } from "./partial-patch.js";
import {
	mkdir,
	mkdtemp,
	open,
	realpath,
	rm,
	stat,
	lstat,
	writeFile,
} from "./runtime.js";
import { dirname, resolve, join } from "node:path";

import type {
	AddRemoteInput,
	BranchCollection,
	BranchIntegrationInput,
	BranchComparison,
	BranchMutationResult,
	ChangeHunkInput,
	ChangeHunkResult,
	CheckoutBranchInput,
	CherryPickCommitInput,
	CloneRepositoryInput,
	CommitInfo,
	CommitFileChange,
	CommitInput,
	CommitFilesInput,
	CommitFilesResult,
	CommitRecoveryInput,
	ResetCommitInput,
	ResetCommitPlan,
	ResetCommitResult,
	SquashCommitsInput,
	SquashCommitsResult,
	SquashPlan,
	ReorderCommitsInput,
	ReorderCommitsResult,
	ReorderPlan,
	UndoCommitResult,
	CommitPage,
	CommitResult,
	ConfigValue,
	CreateBranchInput,
	CreateTagInput,
	CreateReleaseTagInput,
	PushTagInput,
	TagPushResult,
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
	IgnoreFileInput,
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
	RevertCommitInput,
	RevisionSequenceInput,
	SetConfigInput,
	SetRemoteUrlInput,
	SetUpstreamInput,
	SnapshotInput,
	StageInput,
	ResolveConflictInput,
	FinishOperationInput,
	StashInfo,
	StashInput,
	StashReferenceInput,
	SyncResult,
	SyncBranchInput,
	TagInfo,
	UndoDiscardInput,
	UnsetConfigInput,
	WorktreeInfo,
	WorktreePathInput,
} from "./contracts.js";
import { selectHunkPatch } from "./hunk-patch.js";
import { SelectedCommit } from "./selected-commit.js";
import { BranchIntegration } from "./branch-integration.js";
import { TagOperations } from "./tag-operations.js";
import { CommitRecovery } from "./commit-recovery.js";
import { HistoryRewrite } from "./history-rewrite.js";
import { BranchSync } from "./branch-sync.js";
import { GitIgnore } from "./ignore.js";
import { validateHttpAuthentication } from "./http-authentication.js";
import type { RepositoryContext } from "./internal.js";
import {
	GitCommandFailure,
	GitProcess,
	type GitProcessOptions,
} from "./process/git-process.js";
import {
	loadBranches,
	loadCommit,
	loadCommitFiles,
	loadBranchComparison,
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
const COMMIT_OBJECT_ID = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const MAX_HUNK_INDEX = 100_000;
const MAX_CONFLICT_TEXT_BYTES = 512 * 1024;
const CONFLICT_MARKER_LINE = /^(?:<{3,}|>{3,}|={3,}|\|{3,})(?:[ \t].*)?\r?$/m;

type DiscardPatch =
	| string
	| { readonly path: string; readonly sizeBytes: number };

const hasPatch = (patch: DiscardPatch): boolean =>
	typeof patch === "string" ? patch.length > 0 : patch.sizeBytes > 0;

interface PendingDiscardUndo {
	readonly expiresAt: number;
	readonly path: string;
	readonly stagedPatch: DiscardPatch;
	readonly token: string;
	readonly worktreePatch: DiscardPatch;
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

			if (input.httpAuthentication) {
				let url: URL;

				try {
					url = new URL(input.remoteUrl);
				} catch {
					throw invalidInput(
						"clone-repository",
						"Authenticated cloning requires HTTPS."
					);
				}

				const { username, password } = input.httpAuthentication;

				if (
					url.protocol !== "https:" ||
					url.username ||
					url.password ||
					url.search ||
					url.hash ||
					!username ||
					username.length > 2048 ||
					username.includes(":") ||
					!password ||
					password.length > 4096 ||
					/[\p{C}\s]/u.test(username + password) ||
					input.recurseSubmodules
				)
					throw invalidInput(
						"clone-repository",
						"Use a credential-free HTTPS URL and valid one-shot credentials, without submodules."
					);
			}

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
				httpAuthentication: input.httpAuthentication && {
					...input.httpAuthentication,
					url: input.remoteUrl,
				},
				isolateCloneConfiguration: true,
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

			const filePath =
				input.filePath === undefined
					? undefined
					: requireRepositoryPaths([input.filePath], "get-history")[0];

			const revisions = input.revisions?.map((tip) =>
				requireRevision(tip, "Graph tip", "get-history")
			);

			if (revisions && (!revisions.length || revision || filePath))
				throw invalidInput(
					"get-history",
					"Choose nonempty graph tips or a single revision/file history."
				);

			if (filePath && paths)
				throw invalidInput(
					"get-history",
					"Choose single-file history or a path filter, not both."
				);

			// Explicit revisions stay browseable even after checkout to an unborn branch.
			if (!revision && !revisions) {
				const snapshot = await loadSnapshot(this.context, false, input.signal);

				if (snapshot.head.unborn) return EMPTY_HISTORY;
			}

			return await loadHistory(this.context, {
				...input,
				limit,
				offset,
				paths,
				revision,
				revisions,
				filePath,
			});
		});
	}

	/** Returns requested commits absent from every known remote branch. Local refs only; never fetches. */
	async getUnpushedCommits(
		oids: readonly string[],
		options: GitCallOptions = {}
	): Promise<GitResult<readonly string[]>> {
		return await this.read("get-unpushed-commits", async () => {
			for (const oid of oids)
				if (!COMMIT_OBJECT_ID.test(oid))
					throw invalidInput(
						"get-unpushed-commits",
						"Commit IDs must be full hexadecimal object IDs."
					);

			const unique = [...new Set(oids.map((oid) => oid.toLowerCase()))];

			if (!unique.length) return [];

			const input = `${unique.join("\n")}\n`;

			const objects = await this.context.process.run({
				args: ["cat-file", "--batch-check=%(objecttype)"],
				cwd: this.info.root,
				stdin: input,
				signal: options.signal,
			});

			if (
				objects.stdout
					.toString("utf8")
					.trimEnd()
					.split("\n")
					.some((type) => type !== "commit")
			)
				throw invalidInput(
					"get-unpushed-commits",
					"Every object ID must identify an existing commit."
				);

			// Stdin mode avoids name-rev's date cutoff and argument limits, while returning only requested IDs.
			const output = await this.context.process.run({
				args: ["name-rev", "--annotate-stdin", "--refs=refs/remotes/*"],
				cwd: this.info.root,
				stdin: input,
				signal: options.signal,
			});

			const names = output.stdout.toString("utf8").trimEnd().split("\n");

			if (
				names.length !== unique.length ||
				names.some(
					(name, index) =>
						name !== unique[index] &&
						!(name.startsWith(`${unique[index]} (`) && name.endsWith(")"))
				)
			)
				throw new Error("Git returned incomplete commit publication metadata.");

			return unique.filter((oid, index) => names[index] === oid);
		});
	}

	/** Counts all commits reachable from one revision without loading their metadata. Shallow repositories count only available history. */
	async getHistoryCount(
		revision: string,
		options: GitCallOptions = {}
	): Promise<GitResult<number>> {
		return await this.read("get-history-count", async () => {
			const anchored = requireRevision(
				revision,
				"Revision",
				"get-history-count"
			);

			const output = await this.context.process.run({
				args: ["rev-list", "--count", anchored, "--"],
				cwd: this.context.repository.root,
				signal: options.signal,
			});

			const raw = output.stdout.toString("utf8").trim();
			const total = Number(raw);

			if (!raw || !Number.isSafeInteger(total) || total < 0)
				throw new Error("Git returned an invalid history count.");

			return total;
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

	/** Returns paths and blob identities relative to the first parent, including root commits. */
	async getCommitFiles(
		revision: string,
		options: GitCallOptions = {}
	): Promise<GitResult<readonly CommitFileChange[]>> {
		return await this.read("get-commit-files", async () =>
			loadCommitFiles(
				this.context,
				requireRevision(revision, "Revision", "get-commit-files"),
				options.signal
			)
		);
	}

	/** Read-only incoming changes from the common ancestor; never checks out either branch. */
	async compareBranches(
		base: string,
		head: string,
		options: GitCallOptions = {}
	): Promise<GitResult<BranchComparison>> {
		return await this.read("compare-branches", async () =>
			loadBranchComparison(
				this.context,
				requireRevision(base, "Base", "compare-branches"),
				requireRevision(head, "Head", "compare-branches"),
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

	/** Validates a reviewed text resolution before staging that path; leaves operation continuation to the caller. */
	async resolveConflict(
		input: ResolveConflictInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("stage", input.signal, async () => {
			const path = requireRepositoryPaths([input.path], "stage")[0];

			if (!path) throw invalidInput("stage", "Select a conflicted file.");

			const snapshot = await loadSnapshot(this.context, false, input.signal);

			if (
				snapshot.head.oid !== input.expectedHead ||
				snapshot.head.branch !== input.expectedBranch
			)
				throw invalidInput(
					"stage",
					"The branch changed. Refresh before resolving this file."
				);

			const file = snapshot.files.find((entry) => entry.path === path);

			if (file?.recordType !== "unmerged" || file.submodule.startsWith("S"))
				throw invalidInput(
					"stage",
					"This is no longer a supported conflicted file. Refresh first."
				);

			const absolute = resolve(this.context.repository.root, path);

			if (
				(await realpath(absolute)) !== absolute ||
				!(await stat(absolute)).isFile()
			)
				throw invalidInput(
					"stage",
					"Resolve symbolic links and non-regular files using Git outside this app."
				);

			const content = await loadFileContent(
				this.context,
				{ kind: "working" },
				path,
				input.signal
			);

			if (
				content.encoding !== "utf8" ||
				content.content.includes("\0") ||
				content.sizeBytes > MAX_CONFLICT_TEXT_BYTES
			)
				throw invalidInput(
					"stage",
					"Resolve binary or oversized files using Git outside this app."
				);

			if (
				createHash("sha256").update(content.content).digest("hex") !==
				input.expectedContentHash
			)
				throw invalidInput(
					"stage",
					"The file changed since the preview. Refresh and review it before marking resolved."
				);

			if (input.side) {
				if (input.side !== "ours" && input.side !== "theirs")
					throw invalidInput("stage", "Choose ours or theirs.");

				const stage = input.side === "ours" ? 2 : 3;

				const source = await loadFileContent(
					this.context,
					{ kind: "object", objectId: `:${stage}:${path}` },
					path,
					input.signal
				);

				if (input.expectedSideOid && source.revision !== input.expectedSideOid)
					throw invalidInput(
						"stage",
						"The indexed version changed since the preview. Refresh before choosing it."
					);

				const chosen = source.content;

				if (
					source.sizeBytes > MAX_CONFLICT_TEXT_BYTES ||
					source.encoding !== "utf8" ||
					chosen.includes("\0") ||
					CONFLICT_MARKER_LINE.test(chosen)
				)
					throw invalidInput(
						"stage",
						"Resolve binary, oversized, or nested conflicts outside this app."
					);

				await writeFile(absolute, chosen);
			} else if (CONFLICT_MARKER_LINE.test(content.content))
				throw invalidInput(
					"stage",
					"Conflict markers remain. Edit and save the file, then refresh before marking resolved."
				);

			await this.run(["add", "--", path], input.signal);

			return await loadSnapshot(this.context, false, input.signal);
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

			if (
				input.expectedPatch !== undefined &&
				input.expectedPatch !== diff.patch
			)
				throw invalidInput(
					"change-hunk",
					"The diff changed. Refresh and review it before staging."
				);

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

	/** Adds an ignore rule for a reviewed changed file; tracked files and index stay untouched. */
	async ignoreFile(
		input: IgnoreFileInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("ignore-files", input.signal, async () => {
			const pattern = GitIgnore.pattern(input.path, input.rule);
			const before = await loadSnapshot(this.context, false, input.signal);

			if (
				before.operationState !== "normal" ||
				before.head.oid !== input.expectedHead ||
				before.head.branch !== input.expectedBranch ||
				!before.files.some(
					(file) => file.path === input.path && file.recordType !== "unmerged"
				)
			)
				throw invalidInput(
					"ignore-files",
					"Refresh first. The selected file or branch changed, or a Git operation is in progress."
				);

			await GitIgnore.append(this.info.root, pattern);

			return await loadSnapshot(this.context, false, input.signal);
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

			if (input.recovery) {
				if (
					before.operationState !== "normal" ||
					before.head.oid !== input.recovery.expectedHead ||
					before.head.branch !== input.recovery.expectedBranch ||
					selectedFiles.length !== requestedPathSet.size ||
					selectedFiles.some(
						(file) =>
							!requestedPathSet.has(file.path) ||
							file.originalPath ||
							file.submodule.startsWith("S") ||
							file.indexStatus === "type-changed" ||
							file.worktreeStatus === "type-changed"
					)
				)
					throw invalidInput(
						"discard-files",
						"Refresh first. Every selected path must still be an ordinary changed file outside Git operations."
					);

				const checkedParents = new Set([this.info.root]);

				for (const { path } of selectedFiles) {
					const absolute = resolve(this.info.root, path);
					let parent = dirname(absolute);

					// Validate ancestors separately: a leaf link is data, never a directory to traverse.
					while (!checkedParents.has(parent)) {
						const info = await lstat(parent).catch((error: unknown) => {
							if (
								error instanceof Error &&
								"code" in error &&
								error.code === "ENOENT"
							)
								return null;

							throw error;
						});

						if (info && !info.isDirectory())
							throw invalidInput(
								"discard-files",
								`The parent of "${path}" is not a regular repository directory.`
							);

						checkedParents.add(parent);
						parent = dirname(parent);
					}

					try {
						const info = await lstat(absolute);

						if (!info.isFile() && !info.isSymbolicLink())
							throw invalidInput(
								"discard-files",
								`Non-regular file "${path}" requires external Git handling.`
							);
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
				}
			}

			if (input.recovery)
				await mkdir(input.recovery.directory, { mode: 0o700 });

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
				input.signal,
				input.recovery
					? { path: join(input.recovery.directory, "staged.patch") }
					: undefined
			);

			let worktreePatch = await this.captureDiffPatch(
				[
					"diff",
					"--no-ext-diff",
					"--no-color",
					"--binary",
					"--full-index",
					"--",
					...affectedPaths,
				],
				input.signal,
				input.recovery
					? { path: join(input.recovery.directory, "working.patch") }
					: undefined
			);

			const untrackedPatch = await this.captureUntrackedPatch(
				selectedFiles
					.filter((file) => file.recordType === "untracked")
					.map((file) => file.path),
				input.signal,
				input.recovery
					? {
							path: join(input.recovery.directory, "working.patch"),
							append: true,
						}
					: undefined
			);

			if (
				typeof worktreePatch === "string" &&
				typeof untrackedPatch === "string"
			)
				worktreePatch += untrackedPatch;
			else if (typeof untrackedPatch !== "string")
				worktreePatch = untrackedPatch;

			if (!hasPatch(stagedPatch) && !hasPatch(worktreePatch)) {
				throw invalidInput(
					"discard-files",
					"The selected file has no discardable changes."
				);
			}

			if (input.recovery) {
				// Streamed patches are complete before recording instructions or changing any files.
				await writeFile(
					join(input.recovery.directory, "recovery.json"),
					JSON.stringify({
						root: this.info.root,
						head: before.head.oid,
						paths: affectedPaths,
						createdAt: new Date().toISOString(),
					}),
					{ flag: "wx", mode: 0o600 }
				);
				await writeFile(
					join(input.recovery.directory, "README.txt"),
					"Recovery patches preserve staged and unstaged changes separately. Keep this folder. In the original repository, first review current changes and recovery.json. Apply non-empty staged.patch twice: git apply --cached, then git apply. Finally apply non-empty working.patch with git apply. Use --check before each command. Never force or reset if a patch fails. Patches may contain private file contents.\n",
					{ flag: "wx", mode: 0o600 }
				);
			}

			await this.applyPatch(worktreePatch, {
				check: true,
				reverse: true,
				signal: input.signal,
			});
			await this.applyPatch(stagedPatch, {
				check: true,
				cached: true,
				reverse: true,
				signal: input.signal,
			});

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

	/** Commits selected contents or amends an unpublished tip, retaining excluded staged work. */
	async commitFiles(
		input: CommitFilesInput
	): Promise<GitResult<CommitFilesResult>> {
		return await this.mutate(
			"commit",
			input.signal,
			async () => await SelectedCommit.run(this.context, input)
		);
	}

	/** Inspect the reviewed unpublished branch tip without changing Git or contacting remotes. */
	async getCommitRecovery(
		input: CommitRecoveryInput
	): Promise<GitResult<CommitInfo>> {
		return await this.read(
			"commit",
			async () => await CommitRecovery.read(this.context, input)
		);
	}

	/** Removes only the reviewed unpublished tip, retaining its content in a recovery ref. */
	async undoCommit(
		input: CommitRecoveryInput
	): Promise<GitResult<UndoCommitResult>> {
		return await this.mutate(
			"commit",
			input.signal,
			async () => await CommitRecovery.undo(this.context, input)
		);
	}

	/** Reviews an exact ancestor and verifies that all later commits are unpublished. */
	async getResetCommitPlan(
		input: ResetCommitInput
	): Promise<GitResult<ResetCommitPlan>> {
		return await this.read(
			"reset",
			async () => await CommitRecovery.readReset(this.context, input)
		);
	}

	/** Resets unpublished later history, preserving working files/index and retaining a recovery ref. */
	async resetToCommit(
		input: ResetCommitInput
	): Promise<GitResult<ResetCommitResult>> {
		return await this.mutate(
			"reset",
			input.signal,
			async () => await CommitRecovery.reset(this.context, input)
		);
	}

	/** Reviews a consecutive unpublished range and the later commits that must be replayed. */
	async getSquashPlan(
		input: SquashCommitsInput
	): Promise<GitResult<SquashPlan>> {
		return await this.read(
			"squash-commits",
			async () => await HistoryRewrite.review(this.context, input)
		);
	}

	/** Builds an isolated squash before atomically replacing the reviewed branch; originals are retained. */
	async squashCommits(
		input: SquashCommitsInput
	): Promise<GitResult<SquashCommitsResult>> {
		return await this.mutate(
			"squash-commits",
			input.signal,
			async () => await HistoryRewrite.run(this.context, input)
		);
	}

	/** Reviews a consecutive unpublished range and its exact requested replay order. */
	async getReorderPlan(
		input: ReorderCommitsInput
	): Promise<GitResult<ReorderPlan>> {
		return await this.read(
			"reorder-commits",
			async () => await HistoryRewrite.review(this.context, input)
		);
	}

	/** Replays in isolation, verifies unchanged files, then atomically installs the reviewed tip and retains originals. */
	async reorderCommits(
		input: ReorderCommitsInput
	): Promise<GitResult<ReorderCommitsResult>> {
		return await this.mutate(
			"reorder-commits",
			input.signal,
			async () => await HistoryRewrite.run(this.context, input)
		);
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

			if (input.track) args.push("--track=direct");

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

	/** Finishes only the reviewed operation; continuation uses Git's existing message and never stages files implicitly. */
	async finishOperation(
		input: FinishOperationInput
	): Promise<GitResult<RepositorySnapshot>> {
		const operation = `${input.kind}-${input.expectedOperation}` as const;

		return await this.mutate(operation, input.signal, async () => {
			const snapshot = await loadSnapshot(this.context, false, input.signal);

			if (
				snapshot.operationState !== input.expectedOperation ||
				snapshot.head.oid !== input.expectedHead ||
				snapshot.head.branch !== input.expectedBranch ||
				!input.expectedToken ||
				snapshot.operationToken !== input.expectedToken
			)
				throw invalidInput(
					operation,
					"The Git operation changed. Refresh and review it before trying again."
				);

			if (input.kind === "continue") {
				if (snapshot.files.some((file) => file.recordType === "unmerged"))
					throw invalidInput(
						operation,
						"Resolve and stage all conflicted files before continuing."
					);

				if (
					snapshot.files.some(
						(file) =>
							file.recordType !== "untracked" &&
							file.recordType !== "ignored" &&
							file.worktreeStatus !== "unmodified"
					)
				)
					throw invalidInput(
						operation,
						"Unstaged tracked changes remain. Review and stage them outside the app before continuing."
					);
			}

			if (input.expectedOperation === "squash-merge")
				await BranchIntegration.finishSquash(this.context, input);
			else
				await this.run(
					[input.expectedOperation, `--${input.kind}`],
					input.signal
				);

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

	/** Squash-merges or rebases exact reviewed tips; conflicts remain recoverable through finishOperation. */
	async integrateBranch(
		input: BranchIntegrationInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate(
			input.kind,
			input.signal,
			async () => await BranchIntegration.run(this.context, input)
		);
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

	/** Validates both branch tips before switching; a failed replay stays on the destination for inspection or recovery. */
	async cherryPickCommit(
		input: CherryPickCommitInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("cherry-pick", input.signal, async () => {
			if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit))
				throw invalidInput(
					"cherry-pick",
					"Select an exact commit from History."
				);

			const snapshot = await loadSnapshot(this.context, false, input.signal);

			if (
				!input.expectedHead ||
				!input.expectedBranch ||
				snapshot.head.detached ||
				snapshot.head.oid !== input.expectedHead ||
				snapshot.head.branch !== input.expectedBranch
			)
				throw invalidInput(
					"cherry-pick",
					"HEAD or the branch changed. Refresh and review History again."
				);

			if (snapshot.operationState !== "normal" || snapshot.files.length > 0)
				throw invalidInput(
					"cherry-pick",
					"Commit or stash your changes and finish the current Git operation before cherry-picking."
				);

			const targetName = await requireBranchName(
				this.context,
				input.targetBranch,
				"cherry-pick",
				input.signal
			);

			const [branches, commit] = await Promise.all([
				loadBranches(this.context, input.signal),
				loadCommit(this.context, input.commit, input.signal),
			]);

			const target = branches.branches.find(
				(branch) => branch.type === "local" && branch.name === targetName
			);

			if (
				!target ||
				target.oid !== input.expectedTarget ||
				target.checkedOut ||
				target.worktreePath ||
				targetName === input.expectedBranch
			)
				throw invalidInput(
					"cherry-pick",
					"Choose another local branch that is not open in a worktree. Refresh if its tip changed."
				);

			if (commit.parentOids.length > 1)
				throw invalidInput(
					"cherry-pick",
					"Cherry-picking a merge commit requires a mainline parent. Use an external Git tool."
				);

			// The selected commit must still belong to the reviewed History, not an arbitrary ref.
			try {
				await this.run(
					["merge-base", "--is-ancestor", input.commit, input.expectedHead],
					input.signal
				);
			} catch (error) {
				if (error instanceof GitCommandFailure && error.exitCode === 1)
					throw invalidInput(
						"cherry-pick",
						"The commit is no longer in this branch's history. Refresh and review History again."
					);

				throw error;
			}

			let alreadyIncluded = true;

			try {
				await this.run(
					["merge-base", "--is-ancestor", input.commit, target.oid],
					input.signal
				);
			} catch (error) {
				if (!(error instanceof GitCommandFailure && error.exitCode === 1))
					throw error;

				alreadyIncluded = false;
			}

			if (alreadyIncluded)
				throw invalidInput(
					"cherry-pick",
					"This commit is already in the destination branch's history."
				);

			await this.run(["switch", "--no-guess", "--", targetName], input.signal);
			const destination = await loadSnapshot(this.context, false, input.signal);

			if (
				destination.head.branch !== targetName ||
				destination.head.oid !== input.expectedTarget ||
				destination.operationState !== "normal" ||
				destination.files.length > 0
			)
				throw invalidInput(
					"cherry-pick",
					"The destination changed while switching. Inspect Changes before trying again; no commit was copied."
				);

			await this.run(["cherry-pick", input.commit], input.signal);

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

	/** Rechecks reviewed identity under the mutation lock; leaves conflicts available for Continue or Abort. */
	async revertCommit(
		input: RevertCommitInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate("revert", input.signal, async () => {
			if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit))
				throw invalidInput("revert", "Select an exact commit from History.");

			const snapshot = await loadSnapshot(this.context, false, input.signal);

			if (
				!input.expectedHead ||
				!input.expectedBranch ||
				snapshot.head.detached ||
				snapshot.head.oid !== input.expectedHead ||
				snapshot.head.branch !== input.expectedBranch
			)
				throw invalidInput(
					"revert",
					"HEAD or the branch changed. Refresh and review the commit before reverting."
				);

			if (snapshot.operationState !== "normal" || snapshot.files.length > 0)
				throw invalidInput(
					"revert",
					"Commit or stash your changes and finish the current Git operation before reverting."
				);

			const commit = await loadCommit(this.context, input.commit, input.signal);

			if (commit.parentOids.length > 1)
				throw invalidInput(
					"revert",
					"Reverting a merge commit requires choosing a mainline parent. Use an external Git tool."
				);

			try {
				await this.run(
					["merge-base", "--is-ancestor", input.commit, snapshot.head.oid],
					input.signal
				);
			} catch (error) {
				if (error instanceof GitCommandFailure && error.exitCode === 1)
					throw invalidInput(
						"revert",
						"This commit is not in the current branch's history. Refresh and review History again."
					);

				throw error;
			}

			await this.run(["revert", "--no-edit", input.commit], input.signal);

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

	/** Creates only the reviewed release tag; dirty working files and the index are left untouched. */
	async createReleaseTag(
		input: CreateReleaseTagInput
	): Promise<GitResult<RepositorySnapshot>> {
		return await this.mutate(
			"create-tag",
			input.signal,
			async () => await TagOperations.create(this.context, input)
		);
	}

	/** Pushes exactly one reviewed tag without force, mirror, branch publication or implicit extra tags. */
	async pushTag(input: PushTagInput): Promise<GitResult<TagPushResult>> {
		return await this.mutate(
			"push-tag",
			input.signal,
			async () => await TagOperations.push(this.context, input)
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

			if (input.onProgress) args.push("--progress");

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

			if (input.httpAuthentication) {
				const remotes = await loadRemotes(this.context, input.signal);

				validateHttpAuthentication(
					input.httpAuthentication,
					remotes.find((item) => item.name === remote)?.fetchUrls ?? [],
					"fetch"
				);
				args.splice(1, 0, "--recurse-submodules=no");
			}

			await this.context.process.run({
				args,
				cwd: this.info.root,
				signal: input.signal,
				httpAuthentication: input.httpAuthentication,
				onProgress: input.onProgress,
			});

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

	/** Synchronizes exactly the reviewed branch, with fresh identity and destination checks. */
	async syncBranch(input: SyncBranchInput): Promise<GitResult<SyncResult>> {
		return await this.mutate(
			input.kind === "pull" ? "pull" : "push",
			input.signal,
			async () => await BranchSync.run(this.context, input)
		);
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

			if (input.track) args.push("--track");

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
		patch: DiscardPatch,
		options: {
			readonly check?: boolean;
			readonly cached?: boolean;
			readonly reverse?: boolean;
			readonly signal?: AbortSignal;
		}
	): Promise<void> {
		if (!hasPatch(patch)) {
			return;
		}

		const args = ["apply", "--recount", "--whitespace=nowarn"];

		if (options.check) args.push("--check");

		if (options.cached) {
			args.push("--cached");
		}

		if (options.reverse) {
			args.push("--reverse");
		}

		if (typeof patch !== "string") args.push("--", patch.path);

		await this.context.process.run({
			args,
			cwd: this.info.root,
			signal: options.signal,
			stdin: typeof patch === "string" ? patch : undefined,
		});
	}

	private async captureDiffPatch(
		args: readonly string[],
		signal?: AbortSignal,
		destination?: { readonly path: string; readonly append?: boolean },
		indexFile?: string
	): Promise<DiscardPatch> {
		const file = destination
			? await open(destination.path, destination.append ? "a" : "wx", 0o600)
			: undefined;

		try {
			const output = await this.context.process.run({
				args: [
					"--literal-pathspecs",
					...(indexFile
						? ["-c", "core.splitIndex=false", "-c", "core.fsmonitor=false"]
						: []),
					...args.slice(0, 1),
					"--no-textconv",
					...args.slice(1),
				],
				cwd: this.info.root,
				signal,
				indexFile,
				stdoutFile: file?.fd,
			});

			if (file && destination) {
				await file.sync();

				return { path: destination.path, sizeBytes: (await file.stat()).size };
			}

			return output.stdout.toString("utf8");
		} finally {
			await file?.close();
		}
	}

	private async captureUntrackedPatch(
		paths: readonly string[],
		signal?: AbortSignal,
		destination?: { readonly path: string; readonly append?: boolean }
	): Promise<DiscardPatch> {
		if (!paths.length) return "";

		const directory = await mkdtemp(
			join(this.info.gitDirectory, "1git-discard-")
		);

		try {
			const run = async (args: readonly string[], stdin?: string) =>
				await this.context.process.run({
					args: [
						"--literal-pathspecs",
						"-c",
						"core.splitIndex=false",
						"-c",
						"core.fsmonitor=false",
						...args,
					],
					cwd: this.info.root,
					indexFile: join(directory, "index"),
					stdin,
					signal,
				});

			// Intent-to-add records link modes without following their targets or touching real staging.
			await run(["read-tree", "--empty"]);
			await run(
				[
					"add",
					"--intent-to-add",
					"--pathspec-from-file=-",
					"--pathspec-file-nul",
				],
				`${paths.join("\0")}\0`
			);

			return await this.captureDiffPatch(
				[
					"diff",
					"--no-ext-diff",
					"--no-color",
					"--binary",
					"--full-index",
					"--default-prefix",
					"--no-renames",
				],
				signal,
				destination,
				join(directory, "index")
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
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

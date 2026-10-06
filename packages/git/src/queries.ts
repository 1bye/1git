import {
	access,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type {
	BranchCollection,
	BranchComparison,
	CommitInfo,
	CommitFileChange,
	CommitPage,
	DiffInput,
	FileContent,
	FileContentSource,
	FileDiff,
	HistoryInput,
	RemoteInfo,
	RepositoryOperationState,
	RepositorySnapshot,
	StashInfo,
	TagInfo,
	WorktreeInfo,
} from "./contracts.js";
import type { RepositoryContext } from "./internal.js";
import { parseCommitFiles, parseDiffStats } from "./parsers/diff.js";
import {
	HISTORY_FORMAT,
	HISTORY_RECORD_SEPARATOR,
	parseHistory,
} from "./parsers/history.js";
import {
	BRANCH_FORMAT,
	parseBranches,
	parseStashes,
	parseTags,
	STASH_FORMAT,
	TAG_FORMAT,
} from "./parsers/refs.js";
import { parseStatus } from "./parsers/status.js";
import { parseWorktrees } from "./parsers/worktrees.js";
import { GitCommandFailure, GitProcessFailure } from "./process/git-process.js";
import { invalidInput } from "./result.js";

const MAX_FILE_CONTENT_BYTES = 10 * 1024 * 1024;

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const loadOperationState = async (
	gitDirectory: string
): Promise<RepositoryOperationState> => {
	const [merge, rebaseMerge, rebaseApply, cherryPick, revert] =
		await Promise.all([
			pathExists(join(gitDirectory, "MERGE_HEAD")),
			pathExists(join(gitDirectory, "rebase-merge")),
			pathExists(join(gitDirectory, "rebase-apply")),
			pathExists(join(gitDirectory, "CHERRY_PICK_HEAD")),
			pathExists(join(gitDirectory, "REVERT_HEAD")),
		]);

	if (rebaseMerge || rebaseApply) {
		return "rebase";
	}

	if (merge) {
		return "merge";
	}

	if (cherryPick) {
		return "cherry-pick";
	}

	if (revert) {
		return "revert";
	}

	return "normal";
};

const operationToken = async (
	directory: string,
	operation: RepositoryOperationState
): Promise<string | undefined> => {
	if (operation !== "merge" && operation !== "rebase" && operation !== "revert")
		return undefined;

	const files =
		operation === "merge"
			? ["MERGE_HEAD", "ORIG_HEAD"]
			: operation === "revert"
				? ["REVERT_HEAD", "sequencer/head", "sequencer/todo", "sequencer/opts"]
				: ["rebase-merge", "rebase-apply"].flatMap((folder) =>
						[
							"head-name",
							"orig-head",
							"onto",
							"stopped-sha",
							"msgnum",
							"next",
							"last",
						].map((name) => `${folder}/${name}`)
					);

	const hash = createHash("sha256").update(operation);

	for (const file of files) {
		try {
			hash.update(file).update(await readFile(join(directory, file)));
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}
	}

	return hash.digest("hex");
};

/** Loads the complete working-copy state from porcelain status. */
export const loadSnapshot = async (
	context: RepositoryContext,
	includeIgnored = false,
	signal?: AbortSignal
): Promise<RepositorySnapshot> => {
	const args = [
		"--no-optional-locks",
		"status",
		"--porcelain=v2",
		"--branch",
		"--show-stash",
		"--untracked-files=all",
		"-z",
	];

	if (includeIgnored) {
		args.push("--ignored=matching");
	}

	const [output, operationState] = await Promise.all([
		context.process.run({
			args,
			cwd: context.repository.root,
			signal,
		}),
		loadOperationState(context.repository.gitDirectory),
	]);

	const status = parseStatus(output.stdout);

	return {
		files: status.files,
		head: status.head,
		operationState,
		...(operationState === "merge" ||
		operationState === "rebase" ||
		operationState === "revert"
			? {
					operationToken: await operationToken(
						context.repository.gitDirectory,
						operationState
					),
				}
			: {}),
		repository: context.repository,
		stashCount: status.stashCount,
	};
};

/** Loads a bounded page of commit metadata. */
export const loadHistory = async (
	context: RepositoryContext,
	input: HistoryInput
): Promise<CommitPage> => {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;

	const args = [
		"log",
		"--no-decorate",
		`--max-count=${limit + 1}`,
		`--skip=${offset}`,
		`--format=${HISTORY_RECORD_SEPARATOR}${HISTORY_FORMAT}`,
	];

	if (input.revision) {
		args.push(input.revision);
	}

	if (input.paths && input.paths.length > 0) {
		args.push("--", ...input.paths);
	}

	const output = await context.process.run({
		args,
		cwd: context.repository.root,
		signal: input.signal,
	});

	const records = parseHistory(output.stdout);
	const hasMore = records.length > limit;
	const commits = hasMore ? records.slice(0, limit) : records;

	return {
		commits,
		hasMore,
		nextOffset: hasMore ? offset + limit : null,
	};
};

/** Loads metadata for one commit-ish. */
export const loadCommit = async (
	context: RepositoryContext,
	revision: string,
	signal?: AbortSignal
): Promise<CommitInfo> => {
	const output = await context.process.run({
		args: [
			"show",
			"--no-patch",
			`--format=${HISTORY_RECORD_SEPARATOR}${HISTORY_FORMAT}`,
			revision,
			"--",
		],
		cwd: context.repository.root,
		signal,
	});

	const [commit] = parseHistory(output.stdout);

	if (!commit) {
		throw new Error(`Git returned no commit metadata for "${revision}".`);
	}

	return commit;
};

/** Lists committed paths and blob identities without reading their patches. */
export const loadCommitFiles = async (
	context: RepositoryContext,
	revision: string,
	signal?: AbortSignal
): Promise<readonly CommitFileChange[]> => {
	const output = await context.process.run({
		args: [
			"show",
			"--format=",
			"--raw",
			"-z",
			"--no-abbrev",
			"--first-parent",
			"--root",
			"--find-renames",
			"--no-ext-diff",
			"--no-textconv",
			revision,
			"--",
		],
		cwd: context.repository.root,
		signal,
	});

	return parseCommitFiles(output.stdout);
};

/** Resolve endpoints once so subsequent pages and patches describe the same snapshot. */
export const loadBranchComparison = async (
	context: RepositoryContext,
	base: string,
	head: string,
	signal?: AbortSignal
): Promise<BranchComparison> => {
	const [baseCommit, headCommit] = await Promise.all([
		loadCommit(context, base, signal),
		loadCommit(context, head, signal),
	]);

	let ancestors: string;

	try {
		const result = await context.process.run({
			args: ["merge-base", "--all", baseCommit.oid, headCommit.oid],
			cwd: context.repository.root,
			signal,
		});

		ancestors = result.stdout.toString("utf8").trim();
	} catch (error) {
		if (error instanceof GitCommandFailure && error.exitCode === 1)
			throw invalidInput(
				"compare-branches",
				"These branches do not share a common ancestor."
			);

		throw error;
	}

	if (!ancestors || ancestors.includes("\n"))
		throw invalidInput(
			"compare-branches",
			"This comparison requires a single common ancestor."
		);

	const result = await context.process.run({
		args: [
			"diff",
			"--raw",
			"-z",
			"--no-abbrev",
			"--find-renames",
			"--no-ext-diff",
			"--no-textconv",
			ancestors,
			headCommit.oid,
			"--",
		],
		cwd: context.repository.root,
		signal,
	});

	return {
		base: baseCommit.oid,
		head: headCommit.oid,
		mergeBase: ancestors,
		files: parseCommitFiles(result.stdout),
	};
};

/** Loads local and remote-tracking branches. */
export const loadBranches = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<BranchCollection> => {
	const output = await context.process.run({
		args: [
			"for-each-ref",
			"--sort=-committerdate",
			`--format=${BRANCH_FORMAT}`,
			"refs/heads",
			"refs/remotes",
		],
		cwd: context.repository.root,
		signal,
	});

	return parseBranches(output.stdout);
};

/** Loads local tags. */
export const loadTags = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<readonly TagInfo[]> => {
	const output = await context.process.run({
		args: [
			"for-each-ref",
			"--sort=-creatordate",
			`--format=${TAG_FORMAT}`,
			"refs/tags",
		],
		cwd: context.repository.root,
		signal,
	});

	return parseTags(output.stdout);
};

/** Loads stash entries. */
export const loadStashes = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<readonly StashInfo[]> => {
	const output = await context.process.run({
		args: ["stash", "list", `--format=${STASH_FORMAT}`],
		cwd: context.repository.root,
		signal,
	});

	return parseStashes(output.stdout);
};

/** Loads all linked worktrees. */
export const loadWorktrees = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<readonly WorktreeInfo[]> => {
	const output = await context.process.run({
		args: ["worktree", "list", "--porcelain", "-z"],
		cwd: context.repository.root,
		signal,
	});

	return parseWorktrees(output.stdout);
};

const loadRemoteUrls = async (
	context: RepositoryContext,
	name: string,
	push: boolean,
	signal?: AbortSignal
): Promise<readonly string[]> => {
	const args = ["remote", "get-url"];

	if (push) {
		args.push("--push");
	}

	args.push("--all", name);
	const output = await context.process.run({
		args,
		cwd: context.repository.root,
		signal,
	});

	return output.stdout
		.toString("utf8")
		.split("\n")
		.filter((url) => url.length > 0);
};

const loadRemoteDefaultBranch = async (
	context: RepositoryContext,
	name: string,
	signal?: AbortSignal
): Promise<string | null> => {
	const output = await context.process.run({
		args: [
			"for-each-ref",
			"--format=%(symref:short)",
			`refs/remotes/${name}/HEAD`,
		],
		cwd: context.repository.root,
		signal,
	});

	const reference = output.stdout.toString("utf8").trim();
	const prefix = `${name}/`;

	return reference.startsWith(prefix) ? reference.slice(prefix.length) : null;
};

/** Loads configured remotes without parsing human-oriented `remote -v` output. */
export const loadRemotes = async (
	context: RepositoryContext,
	signal?: AbortSignal
): Promise<readonly RemoteInfo[]> => {
	const output = await context.process.run({
		args: ["remote"],
		cwd: context.repository.root,
		signal,
	});

	const names = output.stdout
		.toString("utf8")
		.split("\n")
		.filter((name) => name.length > 0);

	return await Promise.all(
		names.map(async (name): Promise<RemoteInfo> => {
			const [defaultBranch, fetchUrls, pushUrls] = await Promise.all([
				loadRemoteDefaultBranch(context, name, signal),
				loadRemoteUrls(context, name, false, signal),
				loadRemoteUrls(context, name, true, signal),
			]);

			return { defaultBranch, fetchUrls, name, pushUrls };
		})
	);
};

const diffArguments = (
	input: DiffInput,
	format: "numstat" | "patch",
	head?: string
): string[] => {
	const isCommit = input.target.kind === "commit";

	// UI paths are filenames, not patterns; previews must not execute configured external converters.
	const args = [
		"--literal-pathspecs",
		isCommit ? "show" : "diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--find-renames",
	];

	if (isCommit) {
		args.push("--format=", "--first-parent", "--root");
	}

	if (format === "numstat") {
		args.push("--numstat", "-z");
	} else {
		args.push("--patch", `--unified=${input.contextLines ?? 3}`);

		if (input.ignoreWhitespace) {
			args.push("--ignore-all-space");
		}
	}

	if (input.target.kind === "changes" && head) {
		args.push(head);
	} else if (input.target.kind === "staged") {
		args.push("--cached");
	} else if (input.target.kind === "commit") {
		args.push(input.target.revision);
	} else if (input.target.kind === "range") {
		const separator = input.target.mergeBase ? "..." : "..";

		args.push(`${input.target.base}${separator}${input.target.head}`);
	}

	if (input.paths && input.paths.length > 0) {
		args.push("--", ...input.paths);
	}

	return args;
};

const loadUntrackedPathDiff = async (
	context: RepositoryContext,
	path: string,
	input: DiffInput,
	format: "numstat" | "patch"
): Promise<string> => {
	try {
		const output = await context.process.run({
			args: [
				"--literal-pathspecs",
				"diff",
				"--no-index",
				"--no-ext-diff",
				"--no-textconv",
				"--no-color",
				...(format === "numstat" ? ["--numstat", "-z"] : ["--patch"]),
				`--unified=${input.contextLines ?? 3}`,
				...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
				"--",
				"/dev/null",
				path,
			],
			cwd: context.repository.root,
			signal: input.signal,
		});

		return output.stdout.toString("utf8");
	} catch (error: unknown) {
		if (error instanceof GitCommandFailure && error.exitCode === 1) {
			return error.stdout;
		}

		throw error;
	}
};

const loadUntrackedDiff = async (
	context: RepositoryContext,
	input: DiffInput,
	indexFile?: string
): Promise<Pick<FileDiff, "patch" | "stats">> => {
	if (input.target.kind !== "working" && input.target.kind !== "changes") {
		return { patch: "", stats: [] };
	}

	const listArguments = [
		"--literal-pathspecs",
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	];

	if (input.paths && input.paths.length > 0) {
		listArguments.push("--", ...input.paths);
	}

	const untrackedOutput = await context.process.run({
		args: listArguments,
		cwd: context.repository.root,
		indexFile,
		signal: input.signal,
	});

	const untrackedPaths = untrackedOutput.stdout
		.toString("utf8")
		.split("\0")
		.filter(Boolean);

	const diffs = await Promise.all(
		untrackedPaths.map(async (path) => {
			const [patch, counts] = await Promise.all([
				loadUntrackedPathDiff(context, path, input, "patch"),
				loadUntrackedPathDiff(context, path, input, "numstat"),
			]);

			return {
				patch,
				// --no-index compares /dev/null to this path; it is not a rename.
				stats: parseDiffStats(counts).map(({ addedLines, deletedLines }) => ({
					path,
					addedLines,
					deletedLines,
				})),
			};
		})
	);

	return {
		patch: diffs
			.map((diff) => diff.patch)
			.filter(Boolean)
			.join("\n"),
		stats: diffs.flatMap((diff) => diff.stats),
	};
};

const loadDiffWithIndex = async (
	context: RepositoryContext,
	input: DiffInput,
	indexFile?: string,
	head?: string
): Promise<FileDiff> => {
	const statRequest = context.process.run({
		args: diffArguments(input, "numstat", head),
		cwd: context.repository.root,
		indexFile,
		signal: input.signal,
	});

	try {
		const [patchOutput, statOutput, untracked] = await Promise.all([
			context.process.run({
				args: diffArguments(input, "patch", head),
				cwd: context.repository.root,
				indexFile,
				signal: input.signal,
			}),
			statRequest,
			loadUntrackedDiff(context, input, indexFile),
		]);

		return {
			patch: [patchOutput.stdout.toString("utf8"), untracked.patch]
				.filter(Boolean)
				.join("\n"),
			stats: [...parseDiffStats(statOutput.stdout), ...untracked.stats],
			target: input.target,
		};
	} catch (error: unknown) {
		if (
			error instanceof GitProcessFailure &&
			error.reason === "output-too-large"
		) {
			const statOutput = await statRequest;

			return {
				patch: "",
				patchOmittedReason: "too-large",
				stats: parseDiffStats(statOutput.stdout),
				target: input.target,
			};
		}

		throw error;
	}
};

/** Loads patch text and statistics without changing the repository's index or working files. */
export const loadDiff = async (
	context: RepositoryContext,
	input: DiffInput
): Promise<FileDiff> => {
	if (input.target.kind !== "changes")
		return await loadDiffWithIndex(context, input);

	let head: string | undefined;

	try {
		const output = await context.process.run({
			args: ["rev-parse", "--verify", "--quiet", "HEAD"],
			cwd: context.repository.root,
			signal: input.signal,
		});

		head = output.stdout.toString("utf8").trim();
	} catch (error) {
		if (!(error instanceof GitCommandFailure && error.exitCode === 1))
			throw error;
	}

	const directory = await mkdtemp(join(tmpdir(), "1git-diff-"));
	const indexFile = join(directory, "index");

	try {
		await context.process.run({
			args: [
				"-c",
				"core.splitIndex=false",
				"-c",
				"core.fsmonitor=false",
				"read-tree",
				head ?? "--empty",
			],
			cwd: context.repository.root,
			indexFile,
			signal: input.signal,
		});

		if (head) {
			// Keep HEAD paths even if removed from the real index, and recognize staged additions/renames.
			// Only existing object IDs are copied; previews never add working content to the object store.
			const entries = await context.process.run({
				args: [
					"--literal-pathspecs",
					"ls-files",
					"--stage",
					"-z",
					...(input.paths ? ["--", ...input.paths] : []),
				],
				cwd: context.repository.root,
				signal: input.signal,
			});

			await context.process.run({
				args: [
					"-c",
					"core.splitIndex=false",
					"-c",
					"core.fsmonitor=false",
					"update-index",
					"-z",
					"--index-info",
				],
				stdin: entries.stdout,
				cwd: context.repository.root,
				indexFile,
				signal: input.signal,
			});
		}

		return await loadDiffWithIndex(context, input, indexFile, head);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

const requirePreviewSize = (sizeBytes: number): void => {
	if (sizeBytes > MAX_FILE_CONTENT_BYTES) {
		throw new GitProcessFailure(
			"output-too-large",
			"The file is too large to preview."
		);
	}
};

const loadWorkingFile = async (
	context: RepositoryContext,
	path: string
): Promise<Buffer> => {
	const resolvedPath = await realpath(resolve(context.repository.root, path));
	const relativePath = relative(context.repository.root, resolvedPath);

	if (
		relativePath === ".." ||
		relativePath.startsWith("../") ||
		relativePath.startsWith("..\\") ||
		isAbsolute(relativePath)
	) {
		throw new Error("The file preview path leaves the repository.");
	}

	const fileStat = await stat(resolvedPath);

	requirePreviewSize(fileStat.size);

	return await readFile(resolvedPath);
};

const loadGitObject = async (
	context: RepositoryContext,
	object: string,
	signal?: AbortSignal
): Promise<{ readonly content: Buffer; readonly oid: string }> => {
	const resolved = await context.process.run({
		args: ["rev-parse", "--verify", object],
		cwd: context.repository.root,
		signal,
	});

	const oid = resolved.stdout.toString("utf8").trim();

	const type = await context.process.run({
		args: ["cat-file", "-t", oid],
		cwd: context.repository.root,
		signal,
	});

	if (type.stdout.toString("utf8").trim() !== "blob") {
		throw new Error("The requested preview source is not a file.");
	}

	const size = await context.process.run({
		args: ["cat-file", "-s", oid],
		cwd: context.repository.root,
		signal,
	});

	requirePreviewSize(Number(size.stdout.toString("utf8").trim()));
	const output = await context.process.run({
		args: ["cat-file", "blob", oid],
		cwd: context.repository.root,
		signal,
	});

	return { content: output.stdout, oid };
};

/** Loads one bounded file source and selects UTF-8 or base64 representation. */
export const loadFileContent = async (
	context: RepositoryContext,
	source: FileContentSource,
	path: string,
	signal?: AbortSignal
): Promise<FileContent> => {
	let content: Buffer;
	let revision: string;

	if (source.kind === "working") {
		content = await loadWorkingFile(context, path);
		revision = "WORKTREE";
	} else {
		const object =
			source.kind === "object" ? source.objectId : `${source.revision}:${path}`;

		({ content, oid: revision } = await loadGitObject(context, object, signal));
	}

	const decoder = new TextDecoder("utf-8", { fatal: true });

	try {
		return {
			content: decoder.decode(content),
			encoding: "utf8",
			path,
			revision,
			sizeBytes: content.byteLength,
		};
	} catch {
		return {
			content: content.toString("base64"),
			encoding: "base64",
			path,
			revision,
			sizeBytes: content.byteLength,
		};
	}
};

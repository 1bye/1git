import { access } from "node:fs/promises";
import { join } from "node:path";
import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	DiffInput,
	FileContent,
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
import { parseDiffStats } from "./parsers/diff.js";
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
import { GitCommandFailure } from "./process/git-process.js";

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
	if (merge) {
		return "merge";
	}
	if (rebaseMerge || rebaseApply) {
		return "rebase";
	}
	if (cherryPick) {
		return "cherry-pick";
	}
	if (revert) {
		return "revert";
	}
	return "normal";
};

/** Loads the complete working-copy state from porcelain status. */
export const loadSnapshot = async (
	context: RepositoryContext,
	includeIgnored = false,
	signal?: AbortSignal
): Promise<RepositorySnapshot> => {
	const args = [
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
	format: "numstat" | "patch"
): string[] => {
	const isCommit = input.target.kind === "commit";
	const args = [
		isCommit ? "show" : "diff",
		"--no-ext-diff",
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
	}
	if (input.target.kind === "staged") {
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

const loadUntrackedPathPatch = async (
	context: RepositoryContext,
	path: string,
	input: DiffInput
): Promise<string> => {
	try {
		const output = await context.process.run({
			args: [
				"diff",
				"--no-index",
				"--no-ext-diff",
				"--no-color",
				"--patch",
				`--unified=${input.contextLines ?? 3}`,
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

const loadUntrackedPatch = async (
	context: RepositoryContext,
	input: DiffInput
): Promise<string> => {
	if (input.target.kind !== "working") {
		return "";
	}
	const listArguments = ["ls-files", "--others", "--exclude-standard", "-z"];
	if (input.paths && input.paths.length > 0) {
		listArguments.push("--", ...input.paths);
	}
	const untrackedOutput = await context.process.run({
		args: listArguments,
		cwd: context.repository.root,
		signal: input.signal,
	});
	const untrackedPaths = untrackedOutput.stdout
		.toString("utf8")
		.split("\0")
		.filter(Boolean);
	const patches = await Promise.all(
		untrackedPaths.map((path) => loadUntrackedPathPatch(context, path, input))
	);
	return patches.filter(Boolean).join("\n");
};

/** Loads patch text and machine-readable line statistics for one diff target. */
export const loadDiff = async (
	context: RepositoryContext,
	input: DiffInput
): Promise<FileDiff> => {
	const [patchOutput, statOutput, untrackedPatch] = await Promise.all([
		context.process.run({
			args: diffArguments(input, "patch"),
			cwd: context.repository.root,
			signal: input.signal,
		}),
		context.process.run({
			args: diffArguments(input, "numstat"),
			cwd: context.repository.root,
			signal: input.signal,
		}),
		loadUntrackedPatch(context, input),
	]);
	return {
		patch: [patchOutput.stdout.toString("utf8"), untrackedPatch]
			.filter(Boolean)
			.join("\n"),
		stats: parseDiffStats(statOutput.stdout),
		target: input.target,
	};
};

/** Loads one blob and selects UTF-8 or base64 representation. */
export const loadFileContent = async (
	context: RepositoryContext,
	revision: string,
	path: string,
	signal?: AbortSignal
): Promise<FileContent> => {
	const resolved = await context.process.run({
		args: ["rev-parse", "--verify", `${revision}^{commit}`],
		cwd: context.repository.root,
		signal,
	});
	const oid = resolved.stdout.toString("utf8").trim();
	const output = await context.process.run({
		args: ["show", `${oid}:${path}`],
		cwd: context.repository.root,
		signal,
	});
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		return {
			content: decoder.decode(output.stdout),
			encoding: "utf8",
			path,
			revision: oid,
			sizeBytes: output.stdout.byteLength,
		};
	} catch {
		return {
			content: output.stdout.toString("base64"),
			encoding: "base64",
			path,
			revision: oid,
			sizeBytes: output.stdout.byteLength,
		};
	}
};

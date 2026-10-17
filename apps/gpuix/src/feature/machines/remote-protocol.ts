import type { GitRepository } from "@1git/git";

/** Wire compatibility is pinned independently from the application version. */
export const remoteProtocolVersion = 2;
/** Includes base64 file content; frames are bounded on both ends before JSON parsing. */
export const remoteFrameBytes = 96 * 1024 * 1024;

/** Release payloads shared by packaging, target detection and integrity checks. */
export const remoteHelperTargets = [
	"linux-x64",
	"linux-arm64",
	"linux-x64-musl",
	"linux-arm64-musl",
	"darwin-arm64",
	"darwin-x64",
] as const;

/** Explicit RPC allowlist: no constructors, prototype access, executable overrides or arbitrary shell commands. */
export const remoteGitMethods = [
	"getSnapshot",
	"getHistory",
	"getUnpushedCommits",
	"getHistoryCount",
	"getCommit",
	"getCommitFiles",
	"compareBranches",
	"getBranches",
	"getTags",
	"getRemotes",
	"getStashes",
	"getWorktrees",
	"getDiff",
	"getFileContent",
	"resolveConflict",
	"stage",
	"changeHunk",
	"ignoreFile",
	"discardFiles",
	"undoDiscard",
	"stageAll",
	"unstage",
	"unstageAll",
	"restore",
	"reset",
	"commitFiles",
	"getCommitRecovery",
	"undoCommit",
	"getResetCommitPlan",
	"resetToCommit",
	"getSquashPlan",
	"squashCommits",
	"getReorderPlan",
	"reorderCommits",
	"commit",
	"createBranch",
	"checkoutBranch",
	"renameBranch",
	"deleteBranch",
	"setUpstream",
	"merge",
	"finishOperation",
	"abortMerge",
	"continueMerge",
	"rebase",
	"integrateBranch",
	"continueRebase",
	"skipRebase",
	"abortRebase",
	"cherryPick",
	"cherryPickCommit",
	"continueCherryPick",
	"abortCherryPick",
	"revert",
	"revertCommit",
	"continueRevert",
	"abortRevert",
	"createReleaseTag",
	"pushTag",
	"createTag",
	"deleteTag",
	"addRemote",
	"renameRemote",
	"setRemoteUrl",
	"removeRemote",
	"fetch",
	"pull",
	"push",
	"syncBranch",
	"stash",
	"applyStash",
	"popStash",
	"dropStash",
	"createWorktree",
	"moveWorktree",
	"removeWorktree",
	"lockWorktree",
	"unlockWorktree",
	"pruneWorktrees",
	"repairWorktrees",
	"getConfig",
	"setConfig",
	"unsetConfig",
] as const satisfies readonly (keyof GitRepository)[];

export type RemoteGitMethod = (typeof remoteGitMethods)[number];

/** Checks decoded objects before reading protocol properties. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Bounded UTF-8 JSON-line decoder; split multibyte characters are retained as bytes. */
export class RemoteFrames {
	private pending: Buffer[] = [];
	private pendingBytes = 0;

	push(chunk: Buffer): unknown[] {
		const frames: unknown[] = [];
		let start = 0;

		while (start < chunk.length) {
			const newline = chunk.indexOf(10, start);
			const end = newline === -1 ? chunk.length : newline;
			const part = chunk.subarray(start, end);

			this.pendingBytes += part.length;

			if (this.pendingBytes > remoteFrameBytes)
				throw new Error("Remote response exceeded the size limit.");

			this.pending.push(part);

			if (newline === -1) break;

			frames.push(
				JSON.parse(
					Buffer.concat(this.pending, this.pendingBytes).toString("utf8")
				)
			);
			this.pending = [];
			this.pendingBytes = 0;
			start = newline + 1;
		}

		return frames;
	}
}

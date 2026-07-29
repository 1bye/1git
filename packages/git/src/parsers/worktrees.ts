import type { WorktreeInfo } from "../contracts.js";

interface MutableWorktree {
	branch: string | null;
	detached: boolean;
	headOid: string | null;
	locked: boolean;
	lockReason: string | null;
	path: string;
	prunable: boolean;
	pruneReason: string | null;
}

const LOCAL_BRANCH_PREFIX_PATTERN = /^refs\/heads\//;

const emptyWorktree = (): MutableWorktree => ({
	branch: null,
	detached: false,
	headOid: null,
	locked: false,
	lockReason: null,
	path: "",
	prunable: false,
	pruneReason: null,
});

const applyWorktreeEntry = (worktree: MutableWorktree, entry: string): void => {
	const separator = entry.indexOf(" ");
	const key = separator < 0 ? entry : entry.slice(0, separator);
	const value = separator < 0 ? "" : entry.slice(separator + 1);
	switch (key) {
		case "worktree":
			worktree.path = value;
			break;
		case "HEAD":
			worktree.headOid = value;
			break;
		case "branch":
			worktree.branch = value.replace(LOCAL_BRANCH_PREFIX_PATTERN, "");
			break;
		case "detached":
			worktree.detached = true;
			break;
		case "locked":
			worktree.locked = true;
			worktree.lockReason = value || null;
			break;
		case "prunable":
			worktree.prunable = true;
			worktree.pruneReason = value || null;
			break;
		default:
			break;
	}
};

const parseWorktreeRecord = (record: string): WorktreeInfo | null => {
	const worktree = emptyWorktree();
	for (const entry of record.split("\0")) {
		applyWorktreeEntry(worktree, entry);
	}
	return worktree.path ? worktree : null;
};

/** Parses `git worktree list --porcelain -z`. */
export const parseWorktrees = (
	output: Buffer | string
): readonly WorktreeInfo[] => {
	const worktrees: WorktreeInfo[] = [];
	for (const record of output.toString().split("\0\0")) {
		if (!record) {
			continue;
		}
		const worktree = parseWorktreeRecord(record);
		if (worktree) {
			worktrees.push(worktree);
		}
	}
	return worktrees;
};

import type {
	BranchCollection,
	BranchInfo,
	StashInfo,
	TagInfo,
} from "../contracts.js";

export const BRANCH_FORMAT = [
	"%(refname)",
	"%(refname:short)",
	"%(objectname)",
	"%(HEAD)",
	"%(upstream:short)",
	"%(upstream:track,nobracket)",
	"%(committerdate:iso-strict)",
	"%(subject)",
	"%(worktreepath)",
].join("%00");

export const TAG_FORMAT = [
	"%(refname:short)",
	"%(objectname)",
	"%(objecttype)",
	"%(*objectname)",
	"%(creatordate:iso-strict)",
	"%(subject)",
].join("%00");

export const STASH_FORMAT = ["%gd", "%H", "%cI", "%gs"].join("%x00");
const AHEAD_PATTERN = /ahead (\d+)/;
const BEHIND_PATTERN = /behind (\d+)/;
const REMOTE_REF_PATTERN = /^refs\/remotes\/([^/]+)\//;

const parseTracking = (
	value: string
): { readonly ahead: number; readonly behind: number } => {
	const aheadMatch = AHEAD_PATTERN.exec(value);
	const behindMatch = BEHIND_PATTERN.exec(value);

	return {
		ahead: Number.parseInt(aheadMatch?.[1] ?? "0", 10),
		behind: Number.parseInt(behindMatch?.[1] ?? "0", 10),
	};
};

/** Parses local and remote refs emitted by `git for-each-ref`. */
export const parseBranches = (output: Buffer | string): BranchCollection => {
	const branches: BranchInfo[] = [];

	for (const record of output.toString().split("\n")) {
		if (!record) {
			continue;
		}

		const [
			fullName,
			name,
			oid,
			headMarker,
			upstreamValue,
			trackingValue,
			committedAtValue,
			summary,
			worktreePathValue,
		] = record.split("\0");

		if (!(fullName && name && oid)) {
			continue;
		}

		if (fullName.endsWith("/HEAD")) {
			continue;
		}

		const type = fullName.startsWith("refs/remotes/") ? "remote" : "local";
		const tracking = parseTracking(trackingValue ?? "");

		const remoteMatch =
			type === "remote" ? REMOTE_REF_PATTERN.exec(fullName) : null;

		branches.push({
			ahead: tracking.ahead,
			behind: tracking.behind,
			checkedOut: headMarker === "*",
			committedAt: committedAtValue || null,
			fullName,
			name,
			oid,
			remote: remoteMatch?.[1] ?? null,
			summary: summary ?? "",
			type,
			upstream: upstreamValue || null,
			worktreePath: worktreePathValue || null,
		});
	}

	return {
		branches,
		current:
			branches.find((branch) => branch.type === "local" && branch.checkedOut)
				?.name ?? null,
	};
};

/** Parses tag refs emitted by `git for-each-ref`. */
export const parseTags = (output: Buffer | string): readonly TagInfo[] => {
	const tags: TagInfo[] = [];

	for (const record of output.toString().split("\n")) {
		if (!record) {
			continue;
		}

		const [name, oid, objectType, peeledOid, createdAt, message] =
			record.split("\0");

		if (!(name && oid && objectType)) {
			continue;
		}

		tags.push({
			createdAt: createdAt || null,
			message: message ?? "",
			name,
			oid,
			targetOid: peeledOid || oid,
			type: objectType === "tag" ? "annotated" : "lightweight",
		});
	}

	return tags;
};

/** Parses stash entries emitted by `git stash list`. */
export const parseStashes = (output: Buffer | string): readonly StashInfo[] => {
	const stashes: StashInfo[] = [];

	for (const record of output.toString().split("\n")) {
		if (!record) {
			continue;
		}

		const [reference, oid, createdAt, summary] = record.split("\0");

		if (!(reference && oid && createdAt)) {
			continue;
		}

		stashes.push({
			createdAt,
			oid,
			reference,
			summary: summary ?? "",
		});
	}

	return stashes;
};

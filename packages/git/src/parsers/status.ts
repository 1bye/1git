import type { FileChange, FileStatus, HeadState } from "../contracts.js";

export interface ParsedStatus {
	readonly files: readonly FileChange[];
	readonly head: HeadState;
	readonly stashCount: number;
}

interface StatusAccumulator {
	ahead: number;
	behind: number;
	branch: string | null;
	oid: string | null;
	stashCount: number;
	upstream: string | null;
}

const FILE_STATUS: Readonly<Record<string, FileStatus>> = {
	"!": "ignored",
	"?": "untracked",
	".": "unmodified",
	A: "added",
	C: "copied",
	D: "deleted",
	M: "modified",
	R: "renamed",
	T: "type-changed",
	U: "unmerged",
};
const BRANCH_AB_PATTERN = /^# branch\.ab \+(\d+) -(\d+)$/;

const statusFromCode = (code: string): FileStatus =>
	FILE_STATUS[code] ?? "unmodified";

const takeFields = (
	value: string,
	count: number
): { readonly fields: readonly string[]; readonly remainder: string } => {
	const fields: string[] = [];
	let offset = 0;
	for (let index = 0; index < count; index += 1) {
		const separator = value.indexOf(" ", offset);
		if (separator < 0) {
			return { fields, remainder: "" };
		}
		fields.push(value.slice(offset, separator));
		offset = separator + 1;
	}
	return { fields, remainder: value.slice(offset) };
};

const ordinaryChange = (record: string): FileChange | null => {
	const { fields, remainder: path } = takeFields(record.slice(2), 7);
	const [xy, submodule, , , , headOid, indexOid] = fields;
	if (!(xy && submodule && headOid && indexOid && path)) {
		return null;
	}
	return {
		headOid,
		indexOid,
		indexStatus: statusFromCode(xy[0] ?? "."),
		path,
		recordType: "ordinary",
		submodule,
		worktreeStatus: statusFromCode(xy[1] ?? "."),
	};
};

const renamedChange = (
	record: string,
	originalPath: string
): FileChange | null => {
	const { fields, remainder: path } = takeFields(record.slice(2), 8);
	const [xy, submodule, , , , headOid, indexOid, score] = fields;
	if (!(xy && submodule && headOid && indexOid && score && path)) {
		return null;
	}
	return {
		headOid,
		indexOid,
		indexStatus: statusFromCode(xy[0] ?? "."),
		originalPath,
		path,
		recordType: "renamed",
		renameScore: Number.parseInt(score.slice(1), 10),
		submodule,
		worktreeStatus: statusFromCode(xy[1] ?? "."),
	};
};

const unmergedChange = (record: string): FileChange | null => {
	const { fields, remainder: path } = takeFields(record.slice(2), 9);
	const [xy, submodule] = fields;
	if (!(xy && submodule && path)) {
		return null;
	}
	return {
		indexStatus: "unmerged",
		path,
		recordType: "unmerged",
		submodule,
		worktreeStatus: "unmerged",
	};
};

const simpleChange = (
	record: string,
	recordType: "ignored" | "untracked"
): FileChange => ({
	indexStatus: "unmodified",
	path: record.slice(2),
	recordType,
	submodule: "N...",
	worktreeStatus: recordType,
});

const applyHeader = (record: string, status: StatusAccumulator): boolean => {
	if (record.startsWith("# branch.oid ")) {
		const value = record.slice("# branch.oid ".length);
		status.oid = value === "(initial)" ? null : value;
		return true;
	}
	if (record.startsWith("# branch.head ")) {
		const value = record.slice("# branch.head ".length);
		status.branch = value === "(detached)" ? null : value;
		return true;
	}
	if (record.startsWith("# branch.upstream ")) {
		status.upstream = record.slice("# branch.upstream ".length);
		return true;
	}
	if (record.startsWith("# branch.ab ")) {
		const match = BRANCH_AB_PATTERN.exec(record);
		status.ahead = Number.parseInt(match?.[1] ?? "0", 10);
		status.behind = Number.parseInt(match?.[2] ?? "0", 10);
		return true;
	}
	if (record.startsWith("# stash ")) {
		status.stashCount =
			Number.parseInt(record.slice("# stash ".length), 10) || 0;
		return true;
	}
	return false;
};

const parseChangeRecord = (
	records: readonly string[],
	index: number
): { readonly change: FileChange | null; readonly consumedRecords: number } => {
	const record = records[index] ?? "";
	if (record.startsWith("1 ")) {
		return { change: ordinaryChange(record), consumedRecords: 1 };
	}
	if (record.startsWith("2 ")) {
		return {
			change: renamedChange(record, records[index + 1] ?? ""),
			consumedRecords: 2,
		};
	}
	if (record.startsWith("u ")) {
		return { change: unmergedChange(record), consumedRecords: 1 };
	}
	if (record.startsWith("? ")) {
		return { change: simpleChange(record, "untracked"), consumedRecords: 1 };
	}
	if (record.startsWith("! ")) {
		return { change: simpleChange(record, "ignored"), consumedRecords: 1 };
	}
	return { change: null, consumedRecords: 1 };
};

/** Parses `git status --porcelain=v2 --branch --show-stash -z`. */
export const parseStatus = (output: Buffer | string): ParsedStatus => {
	const records = output.toString().split("\0");
	const files: FileChange[] = [];
	const status: StatusAccumulator = {
		ahead: 0,
		behind: 0,
		branch: null,
		oid: null,
		stashCount: 0,
		upstream: null,
	};

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index] ?? "";
		if (!record) {
			continue;
		}
		if (applyHeader(record, status)) {
			continue;
		}
		const parsed = parseChangeRecord(records, index);
		index += parsed.consumedRecords - 1;
		if (parsed.change) {
			files.push(parsed.change);
		}
	}

	return {
		files,
		head: {
			ahead: status.ahead,
			behind: status.behind,
			branch: status.branch,
			detached: status.branch === null && status.oid !== null,
			oid: status.oid,
			unborn: status.oid === null,
			upstream: status.upstream,
		},
		stashCount: status.stashCount,
	};
};

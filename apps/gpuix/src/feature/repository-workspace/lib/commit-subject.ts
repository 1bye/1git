const commitTypes = [
	"feat",
	"fix",
	"refactor",
	"perf",
	"docs",
	"test",
	"build",
	"ci",
	"chore",
	"style",
	"revert",
] as const;

const conventionalSubject =
	/^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?:[ \t]+(\S[^\r\n]*)$/i;

const conventionalPrefix = /^([a-z]+)(?:\([^()\r\n]+\))?!?:/i;

/** Recognized conventional prefix; arbitrary messages are left untouched. */
export type CommitType = (typeof commitTypes)[number];

/** Display-only decomposition; the original Git summary remains authoritative. */
export interface ParsedCommitSubject {
	readonly type: CommitType;
	readonly scope: string | undefined;
	readonly breaking: boolean;
	readonly description: string;
}

/** Reads conventional commit subjects without modifying messages, bodies or Git metadata. */
export class CommitSubject {
	/** Recognizes a typed prefix before its summary is complete; only the ASCII type is colored. */
	static prefix(message: string): { type: CommitType; length: number } | null {
		const match = conventionalPrefix.exec(message);
		const prefix = match?.[1]?.toLowerCase();
		const type = commitTypes.find((candidate) => candidate === prefix);

		if (!match?.[1] || !type) return null;

		return { type, length: match[1].length };
	}

	static parse(subject: string): ParsedCommitSubject | null {
		const match = conventionalSubject.exec(subject);
		const prefix = match?.[1]?.toLowerCase();
		const type = commitTypes.find((type) => type === prefix);

		if (!match || match[0] !== subject || !type || !match[4]) return null;

		return {
			type,
			scope: match[2],
			breaking: match[3] === "!",
			description: match[4],
		};
	}
}

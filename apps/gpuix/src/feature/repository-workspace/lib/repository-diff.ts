import {
	GitRepository,
	type FileChange,
	type FileDiff,
	type GitResult,
} from "@1git/git";

/** Limits native parsing/layout and Git output without silently truncating a patch. */
export const diffLimits = {
	bytes: 512 * 1024,
	lines: 2000,
	lineLength: 4000,
} as const;

/** Index-to-working-tree and HEAD-to-index are intentionally separate comparisons. */
export type ChangeDiffTarget = "working" | "staged";

/** One read-only comparison, ready for the native diff element or an explanatory notice. */
export interface RepositoryDiffSection {
	readonly target: ChangeDiffTarget;
	readonly patch: string;
	readonly stats: FileDiff["stats"];
	readonly message: string | null;
}

const combinedPatch = /^(?:diff --(?:cc|combined) |@@@)/m;
const binaryPatch = /^(?:Binary files .* differ|GIT binary patch)$/m;
const hunkHeader = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const fileHeader = /^diff --git /m;

/** Reads only the selected path, reusing the shared Git backend and GPUIX's patch parser. */
export class RepositoryDiff {
	private constructor() {}

	static async read(
		root: string,
		change: FileChange,
		signal: AbortSignal
	): Promise<GitResult<readonly RepositoryDiffSection[]>> {
		if (change.recordType === "unmerged")
			return {
				ok: true,
				value: [
					{
						target: "working",
						patch: "",
						stats: [],
						message:
							"This file has merge conflicts. A conflict-aware diff viewer is not available yet.",
					},
				],
			};

		const opened = await GitRepository.open({
			path: root,
			signal,
			runtime: { maxOutputBytes: diffLimits.bytes },
		});

		if (!opened.ok) return opened;

		const targets: ChangeDiffTarget[] = [];

		if (change.worktreeStatus !== "unmodified") targets.push("working");

		if (
			change.indexStatus !== "unmodified" &&
			change.indexStatus !== "untracked" &&
			change.indexStatus !== "ignored"
		)
			targets.push("staged");

		if (!targets.length) targets.push("working");

		const results = await Promise.all(
			targets.map(async (target) => {
				// The old name is needed for rename detection in the index, but not for the working-tree comparison.
				const paths =
					target === "staged" && change.originalPath
						? [change.originalPath, change.path]
						: [change.path];

				const result = await opened.value.getDiff({
					target: { kind: target },
					paths,
					signal,
				});

				if (!result.ok) return result;

				return {
					ok: true,
					value: RepositoryDiff.section(result.value, target),
				} as const;
			})
		);

		const sections: RepositoryDiffSection[] = [];

		for (const result of results) {
			if (!result.ok) return result;

			sections.push(result.value);
		}

		return { ok: true, value: sections };
	}

	/** Rejects unsafe-sized or unsupported input before it reaches native parsing; never shows partial content as complete. */
	static section(
		diff: FileDiff,
		target: ChangeDiffTarget
	): RepositoryDiffSection {
		const { patch } = diff;
		const lines = patch.split("\n");
		let message: string | null = null;

		if (
			diff.patchOmittedReason === "too-large" ||
			Buffer.byteLength(patch) > diffLimits.bytes ||
			lines.length > diffLimits.lines ||
			lines.some((line) => line.length > diffLimits.lineLength)
		) {
			message =
				"This diff is too large to preview safely. Inspect it in your editor or Git CLI.";
		} else if (combinedPatch.test(patch)) {
			message =
				"This file has merge conflicts. A conflict-aware diff viewer is not available yet.";
		} else if (
			binaryPatch.test(patch) ||
			diff.stats.some(
				(stat) => stat.addedLines === null || stat.deletedLines === null
			)
		) {
			message = "Binary file — text diff unavailable.";
		} else if (!patch.trim()) {
			message =
				"No remaining changes in this comparison. Refresh Changes if this file was edited elsewhere.";
		} else if (!hunkHeader.test(patch) && !fileHeader.test(patch)) {
			message = "Git returned a patch format this viewer does not support.";
		}

		return {
			target,
			patch: message ? "" : patch,
			stats: diff.stats,
			message,
		};
	}
}

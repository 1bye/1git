import {
	GitRepository,
	type FileChange,
	type FileDiff,
	type GitResult,
} from "@1git/git";

import { imageLimits } from "./image-preview";
import { RepositoryConflicts } from "./repository-conflicts";
import type { CommitFileSelection } from "../types";
import {
	RepositoryImage,
	type RepositoryImageComparison,
} from "./repository-image";

/** Limits native parsing/layout and Git output without silently truncating a patch. */
export const diffLimits = {
	bytes: 512 * 1024,
	lines: 2000,
	lineLength: 4000,
} as const;

/** Index-to-working-tree and HEAD-to-index are intentionally separate comparisons. */
export type ChangeDiffTarget = "working" | "staged";
export type DiffSelection = FileChange | CommitFileSelection;

/** One read-only comparison, ready for the native diff element or an explanatory notice. */
export interface RepositoryDiffSection {
	readonly target: ChangeDiffTarget | "commit";
	readonly patch: string;
	readonly stats: FileDiff["stats"];
	readonly message: string | null;
	readonly image?: RepositoryImageComparison;
	readonly conflict?: { readonly text: string; readonly hash: string };
}

const combinedPatch = /^(?:diff --(?:cc|combined) |@@@)/m;
const binaryPatch = /^(?:Binary files .* differ|GIT binary patch)$/m;
const hunkHeader = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const fileHeader = /^diff --git /m;

/** Reads only the selected path, reusing the shared Git backend and GPUIX's patch parser. */
export class RepositoryDiff {
	private constructor() {}

	/** Applies one reviewed hunk without changing working-file contents. */
	static async writeHunk(
		root: string,
		request: {
			path: string;
			action: "stage" | "unstage";
			hunkIndex: number;
			expectedPatch: string;
		}
	) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const result = await opened.value.changeHunk(request);

		return result.ok
			? { ok: true as const, value: result.value.snapshot }
			: result;
	}

	static async read(
		root: string,
		change: DiffSelection,
		signal: AbortSignal
	): Promise<GitResult<readonly RepositoryDiffSection[]>> {
		if ("commit" in change)
			return await RepositoryDiff.readCommit(root, change, signal);

		if (change.recordType === "unmerged") {
			const content = await RepositoryConflicts.read(root, change.path, signal);

			if (!content.ok) return content;

			return {
				ok: true,
				value: [
					{
						target: "working",
						patch: "",
						stats: [],
						conflict: content.value ?? undefined,
						message: content.value
							? null
							: "Binary or oversized conflict. Resolve and stage this file in your editor or Git CLI, then refresh.",
					},
				],
			};
		}

		const image = RepositoryImage.supports(change.path);

		const opened = await GitRepository.open({
			path: root,
			signal,
			runtime: { maxOutputBytes: image ? imageLimits.bytes : diffLimits.bytes },
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

		const images = image
			? await RepositoryImage.read(opened.value, root, change, targets, signal)
			: null;

		const results = await Promise.all(
			targets.map(async (target) => {
				const preview = images?.get(target);

				if (preview && !preview.svg)
					return {
						ok: true as const,
						value: {
							target,
							patch: "",
							stats: [],
							message: null,
							image: preview,
						},
					};

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
					value: {
						...RepositoryDiff.section(result.value, target),
						image: preview,
					},
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

	/** Shares the existing viewer and image decoder for immutable, first-parent comparisons. */
	private static async readCommit(
		root: string,
		file: CommitFileSelection,
		signal: AbortSignal
	): Promise<GitResult<readonly RepositoryDiffSection[]>> {
		const image = RepositoryImage.supports(file.path);

		const opened = await GitRepository.open({
			path: root,
			signal,
			runtime: { maxOutputBytes: image ? imageLimits.bytes : diffLimits.bytes },
		});

		if (!opened.ok) return opened;

		const preview = image
			? await RepositoryImage.readCommit(opened.value, file, signal)
			: undefined;

		if (preview && !preview.svg)
			return {
				ok: true,
				value: [
					{
						target: "commit",
						patch: "",
						stats: [],
						message: null,
						image: preview,
					},
				],
			};

		const result = await opened.value.getDiff({
			target: file.base
				? { kind: "range", base: file.base, head: file.commit }
				: { kind: "commit", revision: file.commit },
			paths: file.originalPath ? [file.originalPath, file.path] : [file.path],
			signal,
		});

		if (!result.ok) return result;

		return {
			ok: true,
			value: [
				{ ...RepositoryDiff.section(result.value, "commit"), image: preview },
			],
		};
	}

	/** Rejects unsafe-sized or unsupported input before it reaches native parsing; never shows partial content as complete. */
	static section(
		diff: FileDiff,
		target: RepositoryDiffSection["target"]
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
				target === "commit"
					? "No textual changes in this committed file."
					: "No remaining changes in this comparison. Refresh Changes if this file was edited elsewhere.";
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

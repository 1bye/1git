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

/** A live changed file or an immutable file selected from a commit. */
export type DiffSelection = FileChange | CommitFileSelection;

/** One read-only comparison, ready for the native diff element or an explanatory notice. */
export interface RepositoryDiffSection {
	readonly target: "working" | "commit";
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

	/** Reads additional context without decoding images or changing the repository's index. */
	static async readContext(
		root: string,
		change: DiffSelection,
		contextLines: number,
		signal: AbortSignal
	): Promise<string> {
		if (
			!Number.isSafeInteger(contextLines) ||
			contextLines < 1 ||
			contextLines > diffLimits.lines
		)
			throw new Error("Requested diff context exceeds the preview limit.");

		const opened = await GitRepository.open({
			path: root,
			signal,
			runtime: { maxOutputBytes: diffLimits.bytes },
		});

		if (!opened.ok) throw new Error(opened.error.message);

		const result = await opened.value.getDiff({
			target:
				"commit" in change
					? change.base
						? { kind: "range", base: change.base, head: change.commit }
						: { kind: "commit", revision: change.commit }
					: { kind: "changes" },
			paths: change.originalPath
				? [change.originalPath, change.path]
				: [change.path],
			contextLines,
			signal,
		});

		if (!result.ok) throw new Error(result.error.message);

		if (
			result.value.patchOmittedReason ||
			Buffer.byteLength(result.value.patch) > diffLimits.bytes
		)
			throw new Error(
				"Additional context is too large to preview safely. Open the file in your editor."
			);

		return result.value.patch;
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
							: "Binary or oversized conflict. Resolve this file in your editor or Git CLI, then refresh.",
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

		const previewRead = image
			? RepositoryImage.read(opened.value, root, change, signal)
			: undefined;

		if (image && !change.path.toLowerCase().endsWith(".svg"))
			return {
				ok: true,
				value: [
					{
						target: "working",
						patch: "",
						stats: [],
						message: null,
						image: await previewRead,
					},
				],
			};

		const [preview, result] = await Promise.all([
			previewRead,
			opened.value.getDiff({
				target: { kind: "changes" },
				paths: change.originalPath
					? [change.originalPath, change.path]
					: [change.path],
				signal,
			}),
		]);

		if (!result.ok) return result;

		return {
			ok: true,
			value: [
				{ ...RepositoryDiff.section(result.value, "working"), image: preview },
			],
		};
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

		const previewRead = image
			? RepositoryImage.readCommit(opened.value, file, signal)
			: undefined;

		if (image && !file.path.toLowerCase().endsWith(".svg"))
			return {
				ok: true,
				value: [
					{
						target: "commit",
						patch: "",
						stats: [],
						message: null,
						image: await previewRead,
					},
				],
			};

		const [preview, result] = await Promise.all([
			previewRead,
			opened.value.getDiff({
				target: file.base
					? { kind: "range", base: file.base, head: file.commit }
					: { kind: "commit", revision: file.commit },
				paths: file.originalPath ? [file.originalPath, file.path] : [file.path],
				signal,
			}),
		]);

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

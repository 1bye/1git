import { type FileChange, type FileDiff, type GitResult } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

import { imageLimits } from "./image-preview";
import {
	RepositoryConflicts,
	type ConflictPreview,
} from "./repository-conflicts";
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

/** Window-wide display preferences; they never affect file inclusion or commits. */
export interface DiffSettings {
	readonly mode: "unified" | "split";
	readonly splitLayout: "fixed" | "content-sized";
	readonly ignoreWhitespace: boolean;
}
/** Default text preview before a user changes this window's controls. */
export const defaultDiffSettings: DiffSettings = {
	mode: "unified",
	splitLayout: "fixed",
	ignoreWhitespace: false,
};

/** One read-only comparison, ready for the native diff element or an explanatory notice. */
export interface RepositoryDiffSection {
	readonly target: "working" | "commit";
	readonly patch: string;
	/** Complete, unfiltered context for syntax only; never used for display or staging. */
	readonly syntaxPatch?: string;
	readonly stats: FileDiff["stats"];
	readonly message: string | null;
	readonly image?: RepositoryImageComparison;
	readonly conflict?: ConflictPreview;
}

const combinedPatch = /^(?:diff --(?:cc|combined) |@@@)/m;
const binaryPatch = /^(?:Binary files .* differ|GIT binary patch)$/m;
const hunkHeader = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const fileHeader = /^diff --git /m;
const fullContextLines = 2_147_483_647;

/** Git's file/blob headers identify a snapshot even when whitespace filtering changes its hunks. */
const patchHeaders = (patch: string): string => {
	const headers: string[] = [];
	let inHunk = false;

	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) inHunk = false;
		else if (line.startsWith("@@")) inHunk = true;

		if (!inHunk && line) headers.push(line);
	}

	return headers.join("\n");
};

/** Reads only the selected path, reusing the shared Git backend and GPUIX's patch parser. */
export class RepositoryDiff {
	private constructor() {}

	/** Reads additional context without decoding images or changing the repository's index. */
	static async readContext(
		root: string,
		change: DiffSelection,
		contextLines: number,
		signal: AbortSignal,
		ignoreWhitespace = false
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
			ignoreWhitespace,
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
		signal: AbortSignal,
		ignoreWhitespace = false
	): Promise<GitResult<readonly RepositoryDiffSection[]>> {
		if ("commit" in change)
			return await RepositoryDiff.readCommit(
				root,
				change,
				signal,
				ignoreWhitespace
			);

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

		const [preview, { result, syntaxPatch }] = await Promise.all([
			previewRead,
			RepositoryDiff.readText(opened.value, change, signal, ignoreWhitespace),
		]);

		if (!result.ok) return result;

		return {
			ok: true,
			value: [
				{
					...RepositoryDiff.section(result.value, "working", ignoreWhitespace),
					syntaxPatch,
					image: preview,
				},
			],
		};
	}

	/** Shares the existing viewer and image decoder for immutable, first-parent comparisons. */
	private static async readCommit(
		root: string,
		file: CommitFileSelection,
		signal: AbortSignal,
		ignoreWhitespace: boolean
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

		const [preview, { result, syntaxPatch }] = await Promise.all([
			previewRead,
			RepositoryDiff.readText(opened.value, file, signal, ignoreWhitespace),
		]);

		if (!result.ok) return result;

		return {
			ok: true,
			value: [
				{
					...RepositoryDiff.section(result.value, "commit", ignoreWhitespace),
					syntaxPatch,
					image: preview,
				},
			],
		};
	}

	/** Both reads are bounded, cancellable and cached together by the preview cache, never run during scroll. */
	private static async readText(
		repository: GitRepository,
		change: DiffSelection,
		signal: AbortSignal,
		ignoreWhitespace: boolean
	): Promise<{ result: GitResult<FileDiff>; syntaxPatch?: string }> {
		const input = {
			target:
				"commit" in change
					? change.base
						? { kind: "range" as const, base: change.base, head: change.commit }
						: { kind: "commit" as const, revision: change.commit }
					: { kind: "changes" as const },
			paths: change.originalPath
				? [change.originalPath, change.path]
				: [change.path],
			signal,
		};

		const [result, context] = await Promise.all([
			repository.getDiff({ ...input, ignoreWhitespace }),
			repository.getDiff({ ...input, contextLines: fullContextLines }),
		]);

		// Oversized, failed or racing context must not prevent a usable small diff.
		// shortcut: oversized sources use fragment syntax; add incremental context parsing if large-file fidelity is needed.
		const syntaxPatch =
			result.ok &&
			context.ok &&
			!context.value.patchOmittedReason &&
			hunkHeader.test(result.value.patch) &&
			Buffer.byteLength(context.value.patch) <= diffLimits.bytes &&
			patchHeaders(result.value.patch) === patchHeaders(context.value.patch)
				? context.value.patch
				: undefined;

		return { result, syntaxPatch };
	}

	/** Rejects unsafe-sized or unsupported input before it reaches native parsing; never shows partial content as complete. */
	static section(
		diff: FileDiff,
		target: RepositoryDiffSection["target"],
		ignoreWhitespace = false
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
			message = ignoreWhitespace
				? "No textual changes with whitespace changes hidden."
				: target === "commit"
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

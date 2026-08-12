import type {
	DiffFileStat,
	FileChange,
	FileContentSource,
	FileDiff,
} from "@1git/git";
import type { FileDiffMetadata } from "@pierre/diffs";

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};
const NULL_OBJECT_ID_PATTERN = /^0+$/;

export type RepositoryDiffPreviewKind =
	| "binary"
	| "ignored-whitespace"
	| "image"
	| "large"
	| "rename"
	| "text"
	| "unsupported";

export interface RepositoryImagePreviewSources {
	readonly after: FileContentSource | null;
	readonly before: FileContentSource | null;
}

const extensionForPath = (path: string): string =>
	path.toLocaleLowerCase().split(".").at(-1) ?? "";

export const getRepositoryImageMimeType = (path: string): string | null =>
	IMAGE_MIME_TYPES[extensionForPath(path)] ?? null;

export const getRepositoryDiffPreviewKind = ({
	file,
	ignoreWhitespace,
	patchOmittedReason,
	path,
	stat,
}: {
	readonly file: FileDiffMetadata | null;
	readonly ignoreWhitespace: boolean;
	readonly patchOmittedReason: FileDiff["patchOmittedReason"];
	readonly path: string;
	readonly stat: DiffFileStat | null;
}): RepositoryDiffPreviewKind => {
	if (patchOmittedReason === "too-large") {
		return "large";
	}
	if (
		getRepositoryImageMimeType(path) &&
		(stat?.addedLines === null || file?.hunks.length === 0)
	) {
		return "image";
	}
	if (
		stat?.addedLines === null ||
		stat?.deletedLines === null ||
		(file?.hunks.length === 0 && file.type !== "rename-pure")
	) {
		return "binary";
	}
	if (file?.type === "rename-pure") {
		return "rename";
	}
	if (file && file.hunks.length > 0) {
		return "text";
	}
	if (ignoreWhitespace) {
		return "ignored-whitespace";
	}
	return "unsupported";
};

const objectSource = (
	objectId: string | undefined
): FileContentSource | null =>
	objectId && !NULL_OBJECT_ID_PATTERN.test(objectId)
		? { kind: "object", objectId }
		: null;

export const getRepositoryImagePreviewSources = (
	file: FileDiffMetadata | null,
	target: FileDiff["target"],
	change: FileChange | null
): RepositoryImagePreviewSources => {
	const before = objectSource(file?.prevObjectId);
	if (
		file?.type === "deleted" ||
		(target.kind === "working" && change?.worktreeStatus === "deleted")
	) {
		return { after: null, before };
	}
	return {
		after:
			target.kind === "working"
				? { kind: "working" }
				: objectSource(file?.newObjectId),
		before,
	};
};

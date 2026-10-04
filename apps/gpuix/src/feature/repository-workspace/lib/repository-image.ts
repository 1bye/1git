import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange, FileContentSource, GitRepository } from "@1git/git";

import { ImagePreviewDecoder, type ImagePreview } from "./image-preview";
import type { CommitFileSelection } from "../types";

/** One available Git version, including a recoverable read/decode failure. Null sides mean absent files. */
export type RepositoryImageSide =
	| { readonly image: ImagePreview; readonly error: null }
	| { readonly image: null; readonly error: string };

/** Committed and current versions of the selected file. */
export interface RepositoryImageComparison {
	readonly before: RepositoryImageSide | null;
	readonly after: RepositoryImageSide | null;
	readonly svg: boolean;
}

const imageExtension = /\.(?:png|jpe?g|webp|svg)$/iu;
const svgExtension = /\.svg$/iu;
const nullObjectId = /^0+$/u;

/** Reads immutable HEAD blobs and bounded working bytes without staging or writing files. */
export class RepositoryImage {
	private constructor() {}

	static supports(path: string): boolean {
		return imageExtension.test(path);
	}

	/** Committed images come from immutable blobs, never the current index or working tree. */
	static async readCommit(
		repository: GitRepository,
		file: CommitFileSelection,
		signal: AbortSignal
	): Promise<RepositoryImageComparison> {
		const read = async (oid: string): Promise<RepositoryImageSide | null> => {
			if (nullObjectId.test(oid)) return null;

			try {
				const result = await repository.getFileContent({
					path: file.path,
					source: { kind: "object", objectId: oid },
					signal,
				});

				if (!result.ok) return { image: null, error: result.error.message };

				return {
					image: await ImagePreviewDecoder.prepare(result.value, signal),
					error: null,
				};
			} catch (error) {
				signal.throwIfAborted();

				return {
					image: null,
					error:
						error instanceof Error
							? error.message
							: "Could not preview this image.",
				};
			}
		};

		const [before, after] = await Promise.all([
			read(file.beforeOid),
			read(file.afterOid),
		]);

		return { before, after, svg: svgExtension.test(file.path) };
	}

	static async read(
		repository: GitRepository,
		root: string,
		change: FileChange,
		signal: AbortSignal
	): Promise<RepositoryImageComparison> {
		const load = async (
			source: FileContentSource
		): Promise<RepositoryImageSide | null> => {
			try {
				signal.throwIfAborted();

				if (
					source.kind === "working" &&
					(await lstat(join(root, change.path))).isSymbolicLink()
				)
					throw new Error("Symbolic links are not rendered as image previews.");

				const result = await repository.getFileContent({
					path: change.path,
					source,
					signal,
				});

				if (!result.ok) return { image: null, error: result.error.message };

				return {
					image: await ImagePreviewDecoder.prepare(result.value, signal),
					error: null,
				};
			} catch (error) {
				signal.throwIfAborted();

				if (
					source.kind === "working" &&
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "ENOENT"
				)
					return null;

				return {
					image: null,
					error:
						error instanceof Error
							? error.message
							: "Could not preview this image.",
				};
			}
		};

		const object = (
			oid: string | undefined
		): Promise<RepositoryImageSide | null> | null => {
			if (oid && nullObjectId.test(oid)) return null;

			if (!oid)
				return Promise.resolve({
					image: null,
					error: "Image revision is unavailable. Refresh Changes to try again.",
				});

			return load({ kind: "object", objectId: oid });
		};

		const before =
			change.recordType === "untracked" ? null : object(change.headOid);

		const [beforeImage, afterImage] = await Promise.all([
			before,
			load({ kind: "working" }),
		]);

		return {
			before: beforeImage,
			after: afterImage,
			svg: svgExtension.test(change.path),
		};
	}
}

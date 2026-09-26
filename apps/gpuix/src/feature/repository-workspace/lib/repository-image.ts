import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange, FileContentSource, GitRepository } from "@1git/git";

import type { ChangeDiffTarget } from "./repository-diff";
import { ImagePreviewDecoder, type ImagePreview } from "./image-preview";

/** One available Git version, including a recoverable read/decode failure. Null sides mean absent files. */
export type RepositoryImageSide =
	| { readonly image: ImagePreview; readonly error: null }
	| { readonly image: null; readonly error: string };

/** Before/after versions of the selected staged or unstaged comparison. */
export interface RepositoryImageComparison {
	readonly before: RepositoryImageSide | null;
	readonly after: RepositoryImageSide | null;
	readonly svg: boolean;
}

const imageExtension = /\.(?:png|jpe?g|webp|svg)$/iu;
const svgExtension = /\.svg$/iu;
const nullObjectId = /^0+$/u;

/** Reads immutable HEAD/index blobs and bounded working bytes without staging or writing files. */
export class RepositoryImage {
	private constructor() {}

	static supports(path: string): boolean {
		return imageExtension.test(path);
	}

	static async read(
		repository: GitRepository,
		root: string,
		change: FileChange,
		targets: readonly ChangeDiffTarget[],
		signal: AbortSignal
	): Promise<ReadonlyMap<ChangeDiffTarget, RepositoryImageComparison>> {
		// Both comparisons share the index image. This cache lives only for this selection/read.
		const reads = new Map<string, Promise<RepositoryImageSide>>();

		const load = async (
			source: FileContentSource
		): Promise<RepositoryImageSide> => {
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
		): Promise<RepositoryImageSide> | null => {
			if (oid && nullObjectId.test(oid)) return null;

			if (!oid)
				return Promise.resolve({
					image: null,
					error: "Image revision is unavailable. Refresh Changes to try again.",
				});

			let read = reads.get(oid);

			if (!read) {
				read = load({ kind: "object", objectId: oid });
				reads.set(oid, read);
			}

			return read;
		};

		const comparisons = await Promise.all(
			targets.map(async (target) => {
				const before =
					target === "staged"
						? change.indexStatus === "added"
							? null
							: object(change.headOid)
						: change.worktreeStatus === "untracked"
							? null
							: object(change.indexOid);

				const after =
					target === "staged"
						? change.indexStatus === "deleted"
							? null
							: object(change.indexOid)
						: change.worktreeStatus === "deleted"
							? null
							: load({ kind: "working" });

				const [beforeImage, afterImage] = await Promise.all([before, after]);

				return [
					target,
					{
						before: beforeImage,
						after: afterImage,
						svg: svgExtension.test(change.path),
					},
				] as const;
			})
		);

		return new Map(comparisons);
	}
}

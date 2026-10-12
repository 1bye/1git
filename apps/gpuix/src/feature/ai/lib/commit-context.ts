import { GitRepository, PartialPatch } from "@1git/git";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../../repository-workspace/lib/repository-workspace-model";

const maxBytes = 96 * 1024;

/** Read-only AI context uses commit inclusion, not the viewed file, staging, or whitespace-filtered display. */
export class CommitContext {
	static async read(
		state: RepositoryWorkspaceState,
		signal: AbortSignal
	): Promise<string> {
		const root = state.repository?.root;

		if (
			!root ||
			state.preview ||
			state.loading ||
			state.error ||
			state.commit.needsReview ||
			state.amend ||
			RepositoryWorkspaceModel.isBusy(state) ||
			RepositoryWorkspaceModel.commitBlockReason(state) ||
			!state.includedFileIds.length
		)
			throw new Error(
				"Select changes in an idle repository before generating a commit message. Finish or cancel amend first."
			);

		if (state.includedFileIds.length > 100)
			throw new Error("Select at most 100 files for AI generation.");

		const opened = await GitRepository.open({
			path: root,
			signal,
			runtime: { maxOutputBytes: maxBytes * 2 },
		});

		if (!opened.ok)
			throw new Error(
				"Could not read selected Git changes. Refresh the repository and try again."
			);

		const before = await opened.value.getSnapshot({ signal });

		if (!before.ok || before.value.head.oid !== state.repository?.head)
			throw new Error(
				"The branch changed. Refresh the repository before generating a message."
			);

		const patches: string[] = [];
		let bytes = 0;

		for (const id of state.includedFileIds) {
			signal.throwIfAborted();
			const change = state.entries.changes.find(
				(entry) => entry.id === id
			)?.change;

			if (!change)
				throw new Error(
					"Selected files changed. Refresh the repository and try again."
				);

			const result = await opened.value.getDiff({
				target: { kind: "changes" },
				paths: change.originalPath
					? [change.originalPath, change.path]
					: [change.path],
				ignoreWhitespace: false,
				signal,
			});

			if (!result.ok || result.value.patchOmittedReason)
				throw new Error(
					"A selected diff is too large or unavailable. Select fewer changes and try again."
				);

			const partial = state.partialFiles?.[id];
			const raw = result.value.patch;

			if (partial && partial.expectedPatch !== raw)
				throw new Error(
					"Selected lines changed on disk. Refresh and review your selection before generating."
				);

			const patch = partial
				? new PartialPatch(raw).select(partial.includedLines)
				: raw;

			if (!patch.trim())
				throw new Error(
					"A selected file no longer has changes. Refresh and try again."
				);

			// Binary contents never leave the machine; describe only the path/status already in the file list.
			const context = result.value.stats.some(
				(stat) => stat.addedLines === null || stat.deletedLines === null
			)
				? `Binary file ${JSON.stringify(change.path)}; contents omitted.\n`
				: patch;

			bytes += Buffer.byteLength(context);

			if (bytes > maxBytes)
				throw new Error(
					"Select a smaller set of changes for AI generation (up to 96 KiB)."
				);

			patches.push(context);
		}

		const after = await opened.value.getSnapshot({ signal });

		if (!after.ok || after.value.head.oid !== before.value.head.oid)
			throw new Error(
				"The branch changed during generation. Refresh and try again."
			);

		return patches.join("\n");
	}
}

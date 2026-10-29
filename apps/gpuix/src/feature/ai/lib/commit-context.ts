import { PartialPatch } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../../repository-workspace/lib/repository-workspace-model";

const maxBytes = 16 * 1024 * 1024;
const filesPerBatch = 16;

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

		if (state.includedFileIds.length > 1000)
			throw new Error("Select at most 1000 files for AI generation.");

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

		const entries = new Map(
			state.entries.changes.map((entry) => [entry.id, entry])
		);

		const selected = state.includedFileIds.map((id) => {
			const change = entries.get(id)?.change;

			if (!change)
				throw new Error(
					"Selected files changed. Refresh the repository and try again."
				);

			return { change, partial: state.partialFiles?.[id] };
		});

		const patches: string[] = [];
		let bytes = 0;

		for (let offset = 0; offset < selected.length;) {
			signal.throwIfAborted();
			const batch = [selected[offset++]!];

			// Partial patches must remain canonical per file for stale-selection checks.
			if (!batch[0]!.partial) {
				while (
					offset < selected.length &&
					batch.length < filesPerBatch &&
					!selected[offset]!.partial
				)
					batch.push(selected[offset++]!);
			}

			const paths = new Set(
				batch.flatMap(({ change }) =>
					change.originalPath
						? [change.originalPath, change.path]
						: [change.path]
				)
			);

			const result = await opened.value.getDiff({
				target: { kind: "changes" },
				paths: [...paths],
				ignoreWhitespace: false,
				signal,
			});

			if (!result.ok || result.value.patchOmittedReason)
				throw new Error(
					"Could not read the selected diff. Refresh and try again (local limit: 32 MiB per Git command)."
				);

			if (
				result.value.stats.some(
					(stat) =>
						!paths.has(stat.path) ||
						(stat.originalPath && !paths.has(stat.originalPath))
				) ||
				batch.some(
					({ change }) =>
						!result.value.stats.some(
							(stat) =>
								stat.path === change.path || stat.originalPath === change.path
						)
				)
			)
				throw new Error(
					"Selected files changed. Refresh the repository and try again."
				);

			const partial = batch[0]!.partial;
			const raw = result.value.patch;

			if (partial && partial.expectedPatch !== raw)
				throw new Error(
					"Selected lines changed on disk. Refresh and review your selection before generating."
				);

			// Git's patch format omits binary contents; it only names the changed binary paths.
			const context = partial
				? new PartialPatch(raw).select(partial.includedLines)
				: raw;

			if (!context.trim())
				throw new Error(
					"A selected file no longer has changes. Refresh and try again."
				);

			bytes += Buffer.byteLength(context);

			if (bytes > maxBytes)
				throw new Error(
					"Selected changes exceed the local 16 MiB collection limit. Select fewer changes."
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

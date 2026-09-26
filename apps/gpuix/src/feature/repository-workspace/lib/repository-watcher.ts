import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { RepositoryWorkspaceState } from "./repository-workspace-model";

/** Native filesystem subscription for a working tree and its worktree/shared Git metadata. */
export class RepositoryWatcher {
	private constructor() {}

	static watch(
		repository: NonNullable<RepositoryWorkspaceState["repository"]>,
		onChange: () => void,
		onError: (message: string) => void
	): () => void {
		const watchers: FSWatcher[] = [];
		let closed = false;

		const directories = [
			...new Set([
				repository.root,
				repository.gitDirectory,
				repository.commonDirectory,
			]),
		];

		const metadata = [
			...new Set([repository.gitDirectory, repository.commonDirectory]),
		];

		const contains = (parent: string, child: string): boolean => {
			const path = relative(parent, child);

			return (
				path === "" ||
				(!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
			);
		};

		for (const directory of directories) {
			if (
				directories.some(
					(other) => other !== directory && contains(other, directory)
				)
			)
				continue;

			try {
				const watcher = watch(
					directory,
					{ recursive: true },
					(_event, filename) => {
						if (closed) return;

						if (!filename) return onChange();

						const absolute = join(directory, filename);

						const gitDirectory = metadata.find((path) =>
							contains(path, absolute)
						);

						if (gitDirectory) {
							const path = relative(gitDirectory, absolute)
								.split(sep)
								.join("/");

							if (path.endsWith(".lock")) return;

							if (
								!/^(HEAD|index|packed-refs|config|config\.worktree|info\/exclude|refs(?:\/.*)?|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|rebase-merge(?:\/.*)?|rebase-apply(?:\/.*)?|sequencer(?:\/.*)?)$/.test(
									path
								)
							)
								return;
						}

						// ponytail: ignored worktree paths may also invalidate; add batched
						// check-ignore filtering if build-output churn becomes significant.
						onChange();
					}
				);

				watcher.on("error", () => {
					if (!closed)
						onError(
							"File watching stopped. Use Refresh or refocus the window to update."
						);
				});
				watchers.push(watcher);
			} catch {
				onError(
					"File watching is unavailable. Use Refresh or refocus the window to update."
				);
			}
		}

		return () => {
			closed = true;

			for (const watcher of watchers) watcher.close();
		};
	}
}

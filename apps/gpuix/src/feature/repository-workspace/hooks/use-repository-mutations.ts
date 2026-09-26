import { useEffect, useLayoutEffect, useRef, type Dispatch } from "react";

import type {
	WorkspaceTabsAction,
	WorkspaceTabsState,
} from "../../workspace-tabs/lib/workspace-tabs-model";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
} from "../lib/repository-workspace-model";
import { RepositoryCommit } from "../lib/repository-commit";
import { RepositoryReader } from "../lib/repository-reader";
import { RepositorySync } from "../lib/repository-sync";
import {
	RepositoryBranches,
	type BranchRequest,
} from "../../workspace-tabs/lib/repository-branches";

/** Window-owned operations survive menus; fetches lock shared refs across linked worktrees. */
export function useRepositoryMutations(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	writeCommit = RepositoryCommit.write,
	writeBranch = RepositoryBranches.write,
	readRepository = RepositoryReader.read,
	fetchRepository = RepositorySync.fetch
) {
	const tabs = useRef(state.tabs);

	const pending = useRef(
		new Map<string, "commit-started" | "branch-started">()
	);

	const mounted = useRef(true);
	const fetches = useRef(new Map<string, AbortController>());

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const tab of state.tabs) {
			const repository = tab.workspace.repository;

			const operation =
				repository &&
				(fetches.current.has(repository.commonDirectory)
					? "fetch-started"
					: pending.current.get(repository.root));

			if (operation && !RepositoryWorkspaceModel.isBusy(tab.workspace))
				dispatch({
					type: "workspace",
					id: tab.id,
					action: {
						type: operation,
					},
				});
		}
	}, [state.tabs, dispatch]);

	useEffect(() => {
		mounted.current = true;
		const requests = fetches.current;

		return () => {
			mounted.current = false;

			for (const request of requests.values()) request.abort();
		};
	}, []);

	const commit = async (id: string): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			!RepositoryWorkspaceModel.canCommit(workspace) ||
			pending.current.has(repository.root) ||
			fetches.current.has(repository.commonDirectory)
		)
			return;

		const root = repository.root;
		const submittedMessage = workspace.commitMessage;

		const send = (action: RepositoryWorkspaceAction): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.root === root)
					dispatch({
						type: "workspace",
						id: tab.id,
						action:
							action.type === "commit-finished"
								? {
										...action,
										submittedMessage:
											tab.id === id ? submittedMessage : undefined,
									}
								: action,
					});
			}
		};

		pending.current.set(root, "commit-started");
		send({ type: "commit-started" });

		try {
			const result = await writeCommit(root, {
				paths: workspace.includedFileIds,
				message: submittedMessage,
				expectedHead: repository.head,
				expectedBranch: repository.branchName,
			});

			pending.current.delete(root);
			send(
				result.ok
					? { type: "commit-finished", result: result.value }
					: {
							type: "commit-failed",
							message: [result.error.message, result.error.details]
								.filter(Boolean)
								.join("\n"),
						}
			);
		} catch {
			pending.current.delete(root);
			send({
				type: "commit-failed",
				uncertain: true,
				message:
					"Could not confirm the commit outcome. Refresh and inspect History before trying again. Your message has been kept.",
			});
		}
	};

	const changeBranch = async (
		id: string,
		choice: Pick<BranchRequest, "kind" | "name">
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.loading ||
			workspace.error ||
			workspace.commit.needsReview ||
			pending.current.has(repository.root) ||
			fetches.current.has(repository.commonDirectory)
		)
			return "Wait for the current operation or refresh this workspace before switching branches.";

		const send = (action: RepositoryWorkspaceAction): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.root === repository.root)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		pending.current.set(repository.root, "branch-started");
		send({ type: "branch-started" });
		let error: string | null = null;

		try {
			const result = await writeBranch(repository.root, {
				...choice,
				expectedHead: repository.head,
				expectedBranch: repository.branchName,
			});

			if (!result.ok)
				error = [result.error.message, result.error.details]
					.filter(Boolean)
					.join("\n");
		} catch {
			error =
				"Could not confirm the branch change. Check the current branch before retrying.";
		}

		// Even a reported failure can follow a completed checkout (for example, a failed hook).
		// Re-read before enabling other writes, retaining drafts on every outcome.
		try {
			const refreshed = await readRepository(
				repository.root,
				new AbortController().signal
			);

			pending.current.delete(repository.root);
			send(
				refreshed.ok
					? { type: "branch-finished", snapshot: refreshed.value }
					: { type: "branch-finished", error: refreshed.error.message }
			);

			if (!refreshed.ok) error = refreshed.error.message;
		} catch {
			pending.current.delete(repository.root);
			error = "Refresh to confirm the current branch before continuing.";
			send({ type: "branch-finished", error });
		}

		return error;
	};

	const fetch = async (id: string): Promise<void> => {
		const repository = tabs.current.find((tab) => tab.id === id)?.workspace
			.repository;

		if (!repository || fetches.current.has(repository.commonDirectory)) return;

		const related = tabs.current.filter(
			(tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
		);

		if (
			related.some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					(tab.workspace.repository &&
						pending.current.has(tab.workspace.repository.root))
			)
		)
			return;

		const controller = new AbortController();

		fetches.current.set(repository.commonDirectory, controller);

		const send = (action: RepositoryWorkspaceAction, root?: string): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (
					tab.workspace.repository?.commonDirectory ===
						repository.commonDirectory &&
					(!root || tab.workspace.repository.root === root)
				)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		send({ type: "fetch-started" });
		let error: string | null = null;
		let fetchedAt: number | null = null;

		try {
			const result = await fetchRepository(repository.root, controller.signal);

			if (result.ok) fetchedAt = Date.now();
			else
				error =
					result.error.code === "aborted" && controller.signal.aborted
						? "Fetch cancelled."
						: [result.error.message, result.error.details]
								.filter(Boolean)
								.join("\n");
		} catch {
			error = controller.signal.aborted
				? "Fetch cancelled."
				: "Could not complete fetch. Check your connection and credentials, then retry.";
		}

		// A failed or cancelled multi-remote fetch can still update some refs. Re-read every open worktree.
		const roots = new Set(
			tabs.current.flatMap((tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
					? [tab.workspace.repository.root]
					: []
			)
		);

		const outcomes = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...roots].map(async (root) => {
				if (!mounted.current) return;

				try {
					const refreshed = await readRepository(
						root,
						new AbortController().signal
					);

					outcomes.set(root, {
						type: "fetch-finished",
						error,
						fetchedAt,
						...(refreshed.ok
							? { snapshot: refreshed.value }
							: { refreshError: refreshed.error.message }),
					});
				} catch {
					outcomes.set(root, {
						type: "fetch-finished",
						error,
						fetchedAt,
						refreshError:
							"Refresh this workspace to confirm its status after fetching.",
					});
				}
			})
		);
		fetches.current.delete(repository.commonDirectory);

		// Include tabs opened while the post-fetch reads were running, without leaving them locked.
		for (const tab of tabs.current) {
			if (
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
			)
				roots.add(tab.workspace.repository.root);
		}

		for (const root of roots)
			send(
				outcomes.get(root) ?? { type: "fetch-finished", error, fetchedAt },
				root
			);
	};

	const cancelFetch = (id: string): void => {
		const repository = tabs.current.find((tab) => tab.id === id)?.workspace
			.repository;

		if (repository) fetches.current.get(repository.commonDirectory)?.abort();
	};

	return { commit, changeBranch, fetch, cancelFetch };
}

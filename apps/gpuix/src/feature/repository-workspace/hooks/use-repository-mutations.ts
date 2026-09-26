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
import {
	RepositoryBranches,
	type BranchRequest,
} from "../../workspace-tabs/lib/repository-branches";

/** Window-owned writes survive menu/tab switches and serialize commits with branch changes. */
export function useRepositoryMutations(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	writeCommit = RepositoryCommit.write,
	writeBranch = RepositoryBranches.write,
	readRepository = RepositoryReader.read
) {
	const tabs = useRef(state.tabs);

	const pending = useRef(
		new Map<string, "commit-started" | "branch-started">()
	);

	const mounted = useRef(true);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const tab of state.tabs) {
			if (
				tab.workspace.repository &&
				pending.current.has(tab.workspace.repository.root) &&
				!RepositoryWorkspaceModel.isBusy(tab.workspace)
			)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: {
						type:
							pending.current.get(tab.workspace.repository.root) ??
							"commit-started",
					},
				});
		}
	}, [state.tabs, dispatch]);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);

	const commit = async (id: string): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			!RepositoryWorkspaceModel.canCommit(workspace) ||
			pending.current.has(repository.root)
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
			pending.current.has(repository.root)
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

	return { commit, changeBranch };
}

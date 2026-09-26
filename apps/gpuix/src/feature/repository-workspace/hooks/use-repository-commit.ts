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

/** Window-owned writes survive view/tab switches; each repository permits only one in-flight commit. */
export function useRepositoryCommit(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	writeCommit = RepositoryCommit.write
) {
	const tabs = useRef(state.tabs);
	const pending = useRef(new Set<string>());
	const mounted = useRef(true);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const tab of state.tabs) {
			if (
				tab.workspace.repository &&
				pending.current.has(tab.workspace.repository.root) &&
				!tab.workspace.commit.pending
			)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: { type: "commit-started" },
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

		pending.current.add(root);
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

	return { commit };
}

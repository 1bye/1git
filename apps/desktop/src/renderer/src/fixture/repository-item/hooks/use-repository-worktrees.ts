import type { GitResult, WorktreeInfo } from "@1git/git";
import { useState } from "react";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

export type RepositoryWorktreeView = "actions" | "create" | "list";

interface CreateRepositoryWorktreeInput {
	readonly newBranch?: string;
	readonly path: string;
}

interface RepositoryWorktreesState {
	readonly create: (input: CreateRepositoryWorktreeInput) => Promise<boolean>;
	readonly error: string | null;
	readonly isLoading: boolean;
	readonly showActions: () => void;
	readonly showCreate: () => void;
	readonly showList: () => Promise<void>;
	readonly view: RepositoryWorktreeView;
	readonly worktrees: readonly WorktreeInfo[];
}

const resultValue = <Value>(result: GitResult<Value>): Value => {
	if (!result.ok) {
		const { details, message } = result.error;

		throw new Error(
			details && details !== message ? `${message} ${details}` : message
		);
	}

	return result.value;
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "The worktree operation failed.";

export const useRepositoryWorktrees = (
	sessionId: RepositorySessionId | null
): RepositoryWorktreesState => {
	const [view, setView] = useState<RepositoryWorktreeView>("actions");
	const [worktrees, setWorktrees] = useState<readonly WorktreeInfo[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const showActions = (): void => {
		setError(null);
		setView("actions");
	};

	const showCreate = (): void => {
		setError(null);
		setView("create");
	};

	const showList = async (): Promise<void> => {
		if (!sessionId) {
			return;
		}

		setError(null);
		setIsLoading(true);
		setView("list");

		try {
			setWorktrees(
				resultValue(await window.desktop.git.worktrees.list(sessionId))
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setIsLoading(false);
		}
	};

	const create = async ({
		newBranch,
		path,
	}: CreateRepositoryWorktreeInput): Promise<boolean> => {
		if (!sessionId) {
			return false;
		}

		setError(null);
		setIsLoading(true);

		try {
			setWorktrees(
				resultValue(
					await window.desktop.git.worktrees.create(sessionId, {
						newBranch,
						path,
					})
				)
			);
			setView("list");

			return true;
		} catch (cause) {
			setError(errorMessage(cause));

			return false;
		} finally {
			setIsLoading(false);
		}
	};

	return {
		create,
		error,
		isLoading,
		showActions,
		showCreate,
		showList,
		view,
		worktrees,
	};
};

import type { GitOperation } from "@1git/git";

import {
	GIT_IPC_EVENTS,
	type GitOperationId,
	type RepositoryRefreshEvent,
} from "../../shared/git-ipc.js";
import type { RepositorySessionId } from "../../shared/repository-session.js";
import type { RepositoryManager } from "./repository-manager.js";

interface RepositoryEventTarget {
	readonly send: (channel: string, event: RepositoryRefreshEvent) => void;
}

type RepositorySessionReader = Pick<RepositoryManager, "getActiveSession">;

interface RepositoryMutationNotification {
	readonly operation: GitOperation;
	readonly operationId?: GitOperationId;
	readonly sessionId: RepositorySessionId;
}

const currentTimestamp = (): string => new Date().toISOString();

export const publishRepositoryMutation = (
	target: RepositoryEventTarget,
	notification: RepositoryMutationNotification,
	now: () => string = currentTimestamp
): void => {
	const event: RepositoryRefreshEvent = {
		occurredAt: now(),
		operation: notification.operation,
		...(notification.operationId
			? { operationId: notification.operationId }
			: {}),
		sessionId: notification.sessionId,
		source: "mutation",
	};
	target.send(GIT_IPC_EVENTS.repositoryRefresh, event);
};

export const publishActiveRepositoryFocus = (
	target: RepositoryEventTarget,
	repositoryManager: RepositorySessionReader,
	now: () => string = currentTimestamp
): boolean => {
	const activeSession = repositoryManager.getActiveSession();
	if (!activeSession) {
		return false;
	}

	target.send(GIT_IPC_EVENTS.repositoryRefresh, {
		occurredAt: now(),
		sessionId: activeSession.id,
		source: "window-focus",
	});
	return true;
};

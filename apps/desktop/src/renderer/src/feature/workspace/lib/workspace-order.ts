import type {
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

const hasSameOrder = (
	first: readonly RepositorySessionId[],
	second: readonly RepositorySessionId[]
): boolean =>
	first.length === second.length &&
	first.every((sessionId, index) => sessionId === second[index]);

export const reconcileWorkspaceOrder = (
	currentOrder: readonly RepositorySessionId[],
	sessions: readonly RepositorySessionRecord[]
): readonly RepositorySessionId[] => {
	const availableSessionIds = new Set(sessions.map((session) => session.id));
	const nextOrder: RepositorySessionId[] = [];

	for (const sessionId of currentOrder) {
		if (availableSessionIds.delete(sessionId)) {
			nextOrder.push(sessionId);
		}
	}

	for (const session of sessions) {
		if (availableSessionIds.delete(session.id)) {
			nextOrder.push(session.id);
		}
	}

	return hasSameOrder(currentOrder, nextOrder) ? currentOrder : nextOrder;
};

export const moveWorkspaceInOrder = (
	currentOrder: readonly RepositorySessionId[],
	activeSessionId: RepositorySessionId,
	overSessionId: RepositorySessionId
): readonly RepositorySessionId[] => {
	const activeIndex = currentOrder.indexOf(activeSessionId);
	const overIndex = currentOrder.indexOf(overSessionId);

	if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
		return currentOrder;
	}

	const nextOrder = [...currentOrder];
	const [movedSessionId] = nextOrder.splice(activeIndex, 1);

	if (!movedSessionId) {
		return currentOrder;
	}

	nextOrder.splice(overIndex, 0, movedSessionId);

	return nextOrder;
};

import { useEffect, useRef } from "react";

import type { RepositoryRefreshEvent } from "../../../../../shared/git-ipc.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

export const DEFAULT_REPOSITORY_REFRESH_DEBOUNCE_MS = 120;

export interface RepositoryRefreshDebouncer {
	readonly dispose: () => void;
	readonly flush: () => void;
	readonly schedule: (event: RepositoryRefreshEvent) => void;
}

export const createRepositoryRefreshDebouncer = (
	onRefresh: (event: RepositoryRefreshEvent) => void,
	delayMs = DEFAULT_REPOSITORY_REFRESH_DEBOUNCE_MS
): RepositoryRefreshDebouncer => {
	if (!Number.isFinite(delayMs) || delayMs < 0) {
		throw new Error("Repository refresh delay must be a non-negative number.");
	}

	const pendingEvents = new Map<RepositorySessionId, RepositoryRefreshEvent>();
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const flush = (): void => {
		if (timeout !== undefined) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		const events = [...pendingEvents.values()];
		pendingEvents.clear();
		for (const event of events) {
			onRefresh(event);
		}
	};

	const schedule = (event: RepositoryRefreshEvent): void => {
		pendingEvents.set(event.sessionId, event);
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(flush, delayMs);
	};

	const dispose = (): void => {
		if (timeout !== undefined) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		pendingEvents.clear();
	};

	return { dispose, flush, schedule };
};

/**
 * Runs a repository view's refresh callback after coalescing mutation and
 * window-focus notifications for its session.
 */
export const useRepositoryRefresh = (
	sessionId: RepositorySessionId | null,
	onRefresh: (event: RepositoryRefreshEvent) => void,
	delayMs = DEFAULT_REPOSITORY_REFRESH_DEBOUNCE_MS
): void => {
	const onRefreshRef = useRef(onRefresh);

	useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);

	useEffect(() => {
		if (!sessionId) {
			return;
		}

		const debouncer = createRepositoryRefreshDebouncer((event) => {
			if (event.sessionId === sessionId) {
				onRefreshRef.current(event);
			}
		}, delayMs);
		const unsubscribe = window.desktop.git.events.onRepositoryRefresh(
			debouncer.schedule
		);

		return () => {
			unsubscribe();
			debouncer.dispose();
		};
	}, [delayMs, sessionId]);
};

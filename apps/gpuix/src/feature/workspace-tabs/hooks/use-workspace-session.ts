import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "../lib/workspace-session";
import type { WorkspaceTabsState } from "../lib/workspace-tabs-model";
import type { DiffSettings } from "../../repository-workspace/lib/repository-diff";

/** Saves only changed session intent; flushes the latest rendered draft on unmount and normal process exit. */
export function useWorkspaceSession(
	state: WorkspaceTabsState,
	save: ((document: WorkspaceSessionDocument) => void) | undefined,
	initialError?: string,
	diffSettings?: DiffSettings
) {
	const content =
		state.preview || !save
			? null
			: JSON.stringify(WorkspaceSession.capture(state, diffSettings));

	const latest = useRef(content);
	const saved = useRef<string | null>(null);
	const [error, setError] = useState(initialError);
	const mounted = useRef(false);

	const flush = useCallback((): void => {
		if (!save || latest.current === null || saved.current === latest.current)
			return;

		try {
			save(WorkspaceSession.parse(latest.current));
			saved.current = latest.current;

			if (mounted.current) setError(undefined);
		} catch (cause) {
			if (mounted.current)
				setError(
					`Session not saved. ${cause instanceof Error ? cause.message : "Check available disk space and permissions."}`
				);
			else
				process.stderr.write(
					"1git: Could not save the workspace session before exit.\n"
				);
		}
	}, [save]);

	useLayoutEffect(() => {
		latest.current = content;

		if (content === null) return;

		// ponytail: bounded 1 MiB JSON, debounced synchronous replacement; move I/O off-thread if profiling shows stalls.
		const timer = setTimeout(flush, 200);

		return () => clearTimeout(timer);
	}, [content, flush]);

	useLayoutEffect(() => {
		mounted.current = true;
		saved.current = null;
		const onExit = (): void => {
			mounted.current = false;
			flush();
		};

		process.on("exit", onExit);

		return () => {
			onExit();
			process.removeListener("exit", onExit);
		};
	}, [flush]);

	return { error, retry: flush };
}

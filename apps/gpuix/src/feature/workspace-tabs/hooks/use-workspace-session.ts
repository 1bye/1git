import type { TourTips } from "../../guided-tour/guided-tour";
import type { KeybindOverrides } from "../../keybinds/keybinds";
import type { RepositoryFileLayout } from "../../repository-workspace/lib/repository-file-tree";
import type { AppTypography } from "../../appearance-settings/app-typography";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	WorkspaceSession,
	type OnboardingStep,
	type WorkspaceSessionDocument,
} from "../lib/workspace-session";
import type { WorkspaceTabsState } from "../lib/workspace-tabs-model";
import type { DiffSettings } from "../../repository-workspace/lib/repository-diff";
import type { AppAppearancePreference } from "../../../styles/tokens";
import { AppTermination } from "../../../app-termination";
import type { RepositoryColorChoices } from "../../repository-appearance/repository-colors";
import type { RepositoryDiscoveryPreferences } from "../../repository-discovery/repository-discovery";
import type { RepositoryPatternChoices } from "../../repository-appearance/repository-patterns";
import type { RepositoryLibraryPreferences } from "../../repository-discovery/repository-library";

/** Saves only changed session intent; flushes the latest rendered draft on unmount and normal process exit. */
export function useWorkspaceSession(
	state: WorkspaceTabsState,
	save: ((document: WorkspaceSessionDocument) => void) | undefined,
	initialError?: string,
	diffSettings?: DiffSettings,
	appearance?: AppAppearancePreference,
	commitTypeBadges?: boolean,
	onboarding?: OnboardingStep,
	repositoryColors?: RepositoryColorChoices,
	repositoryDiscovery?: RepositoryDiscoveryPreferences,
	repositoryPatterns?: RepositoryPatternChoices,
	repositoryLibrary?: RepositoryLibraryPreferences,
	smoothTransitions?: boolean,
	showScrollbars?: boolean,
	typography?: AppTypography,
	tips?: TourTips,
	keybinds?: KeybindOverrides,
	fileListLayout?: RepositoryFileLayout,
	showGrain?: boolean
) {
	const content =
		state.preview || !save
			? null
			: JSON.stringify(
					WorkspaceSession.capture(
						state,
						diffSettings,
						appearance,
						commitTypeBadges,
						onboarding,
						repositoryColors,
						repositoryDiscovery,
						repositoryPatterns,
						repositoryLibrary,
						smoothTransitions,
						showScrollbars,
						typography,
						tips,
						keybinds,
						fileListLayout,
						showGrain
					)
				);

	const latest = useRef(content);
	const saved = useRef<string | null>(null);
	const [error, setError] = useState(initialError);
	const mounted = useRef(false);

	const flush = useCallback((): boolean => {
		if (!save || latest.current === null || saved.current === latest.current)
			return true;

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

			return false;
		}

		return true;
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
		const unregister = AppTermination.register(flush);

		return () => {
			onExit();
			process.removeListener("exit", onExit);
			unregister();
		};
	}, [flush]);

	return { error, retry: flush };
}

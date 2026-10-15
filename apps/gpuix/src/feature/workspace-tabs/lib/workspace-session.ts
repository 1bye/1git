import { basename, isAbsolute } from "node:path";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryPreferences,
} from "../../repository-discovery/repository-discovery";
import type { AppAppearance } from "../../../styles/tokens";
import {
	RepositoryColors,
	type RepositoryColorChoices,
} from "../../repository-appearance/repository-colors";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
import type { WorkspaceTabsState } from "./workspace-tabs-model";
import type { RepositoryView } from "../../repository-workspace/types";
import {
	defaultDiffSettings,
	type DiffSettings,
} from "../../repository-workspace/lib/repository-diff";

/** First-run progress, independent of repository history; older sessions remain complete. */
export type OnboardingStep = "welcome" | "git" | "repository" | "complete";

/** Stable navigation intent, separate from Git data and commit inclusion. */
interface WorkspaceNavigation {
	readonly view: RepositoryView;
	readonly changes: string | null;
	readonly history: string | null;
	readonly historyFile: string | null;
	readonly historyLimit: number;
	readonly stashes: string | null;
	readonly stashFile: string | null;
}

/** Versioned local session intent; never contains Git snapshots, credentials or pending operations. */
export interface WorkspaceSessionDocument {
	readonly version: 1;
	readonly tabs: readonly {
		readonly id: string;
		readonly path: string | null;
		readonly draft: string;
		readonly navigation?: WorkspaceNavigation;
	}[];
	readonly activeId: string | null;
	readonly recentRepositories?: readonly string[];
	readonly repositoryDiscovery?: RepositoryDiscoveryPreferences;
	readonly diffSettings?: DiffSettings;
	readonly appearance?: AppAppearance;
	readonly commitTypeBadges?: boolean;
	readonly repositoryColors?: RepositoryColorChoices;
	readonly onboarding?: OnboardingStep;
}

const tabIdPattern = /^workspace-([1-9]\d*)$/;
const historyRestoreExtraRows = 50;
const historyRestoreMaxRows = 10000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Projects persistent tab intent into fresh, disconnected workspaces for read-only restoration. */
export class WorkspaceSession {
	private constructor() {}

	private static diffSettings(value: unknown): DiffSettings | undefined {
		if (
			!isRecord(value) ||
			(value.mode !== "unified" && value.mode !== "split") ||
			typeof value.ignoreWhitespace !== "boolean"
		)
			return undefined;

		return {
			mode: value.mode,
			ignoreWhitespace: value.ignoreWhitespace,
			splitLayout:
				value.splitLayout === "content-sized"
					? "content-sized"
					: defaultDiffSettings.splitLayout,
		};
	}

	private static navigation(value: unknown): WorkspaceNavigation | undefined {
		if (!isRecord(value)) return undefined;

		const {
			view,
			changes,
			history,
			historyFile,
			historyLimit,
			stashes,
			stashFile,
		} = value;

		const isSelection = (item: unknown): item is string | null =>
			item === null || (typeof item === "string" && !item.includes("\0"));

		if (
			(view !== "changes" && view !== "history" && view !== "stashes") ||
			!isSelection(changes) ||
			!isSelection(history) ||
			!isSelection(historyFile) ||
			!isSelection(stashes) ||
			!isSelection(stashFile) ||
			typeof historyLimit !== "number" ||
			!Number.isSafeInteger(historyLimit) ||
			historyLimit < 0 ||
			historyLimit > historyRestoreMaxRows
		)
			return undefined;

		return {
			view,
			changes,
			history,
			historyFile,
			historyLimit,
			stashes,
			stashFile,
		};
	}

	static parse(content: string): WorkspaceSessionDocument {
		const value: unknown = JSON.parse(content);

		if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tabs))
			throw new Error(
				"The saved session is invalid or uses an unsupported version."
			);

		const tabs: WorkspaceSessionDocument["tabs"][number][] = [];
		const ids = new Set<string>();

		for (const tab of value.tabs) {
			if (
				!isRecord(tab) ||
				typeof tab.id !== "string" ||
				!tabIdPattern.test(tab.id) ||
				!Number.isSafeInteger(Number(tab.id.slice("workspace-".length)) + 1) ||
				ids.has(tab.id) ||
				typeof tab.draft !== "string" ||
				!(
					tab.path === null ||
					(typeof tab.path === "string" &&
						isAbsolute(tab.path) &&
						!tab.path.includes("\0"))
				)
			)
				throw new Error("The saved session contains an invalid workspace.");

			ids.add(tab.id);
			tabs.push({
				id: tab.id,
				path: tab.path,
				draft: tab.draft,
				navigation: WorkspaceSession.navigation(tab.navigation),
			});
		}

		const diffSettings = WorkspaceSession.diffSettings(value.diffSettings);
		const repositoryColors = RepositoryColors.parse(value.repositoryColors);

		const repositoryDiscovery = RepositoryDiscovery.preferences(
			value.repositoryDiscovery
		);

		return {
			version: 1,
			tabs,
			...(value.appearance === "light" || value.appearance === "dark"
				? { appearance: value.appearance }
				: {}),
			...(typeof value.commitTypeBadges === "boolean"
				? { commitTypeBadges: value.commitTypeBadges }
				: {}),
			...(value.onboarding === "welcome" ||
			value.onboarding === "git" ||
			value.onboarding === "repository" ||
			value.onboarding === "complete"
				? { onboarding: value.onboarding }
				: {}),
			...(diffSettings ? { diffSettings } : {}),
			...(Object.keys(repositoryColors).length ? { repositoryColors } : {}),
			...(repositoryDiscovery.folders.length ||
			repositoryDiscovery.hidden.length
				? { repositoryDiscovery }
				: {}),
			...(Array.isArray(value.recentRepositories)
				? {
						recentRepositories: [
							...new Set(
								value.recentRepositories.filter(
									(path): path is string =>
										typeof path === "string" &&
										isAbsolute(path) &&
										!path.includes("\0")
								)
							),
						].slice(0, 100),
					}
				: {}),
			activeId:
				value.activeId === null
					? null
					: typeof value.activeId === "string" && ids.has(value.activeId)
						? value.activeId
						: (tabs[0]?.id ?? null),
		};
	}

	static capture(
		state: WorkspaceTabsState,
		diffSettings?: DiffSettings,
		appearance?: AppAppearance,
		commitTypeBadges?: boolean,
		onboarding?: OnboardingStep,
		repositoryColors?: RepositoryColorChoices,
		repositoryDiscovery?: RepositoryDiscoveryPreferences
	): WorkspaceSessionDocument {
		return {
			version: 1,
			...(appearance ? { appearance } : {}),
			...(commitTypeBadges !== undefined ? { commitTypeBadges } : {}),
			...(onboarding ? { onboarding } : {}),
			...(diffSettings ? { diffSettings } : {}),
			...(repositoryDiscovery &&
			(repositoryDiscovery.folders.length || repositoryDiscovery.hidden.length)
				? { repositoryDiscovery }
				: {}),
			...(repositoryColors && Object.keys(repositoryColors).length
				? { repositoryColors }
				: {}),
			...(state.recentRepositories !== undefined
				? { recentRepositories: state.recentRepositories }
				: {}),
			tabs: state.tabs.map(({ id, workspace }) => ({
				id,
				path: workspace.repository?.root ?? workspace.repositoryPath,
				draft: workspace.amend?.previousMessage ?? workspace.commitMessage,
				navigation: {
					view: workspace.view,
					changes: workspace.views.changes.selectedId,
					// File history is temporary navigation; restore the full list's selection after restart.
					history: workspace.history.file
						? (workspace.history.normal?.view.selectedId ?? null)
						: workspace.views.history.selectedId,
					historyFile: workspace.history.file
						? (workspace.history.normal?.view.files.selectedId ?? null)
						: workspace.views.history.files.selectedId,
					historyLimit:
						workspace.restoreHistoryLimit ??
						Math.min(
							historyRestoreMaxRows,
							(workspace.history.file
								? (workspace.history.normal?.entries.length ?? 0)
								: workspace.entries.history.length) + historyRestoreExtraRows
						),
					stashes: workspace.views.stashes.selectedId,
					stashFile: workspace.views.stashes.files.selectedId,
				},
			})),
			activeId: state.activeId,
		};
	}

	static restore(document: WorkspaceSessionDocument): WorkspaceTabsState {
		return {
			preview: false,
			recentRepositories: [
				...new Set(
					document.recentRepositories ??
						document.tabs.flatMap((tab) => (tab.path ? [tab.path] : []))
				),
			].slice(0, 100),
			tabs: document.tabs.map(({ id, path, draft, navigation }) => ({
				id,
				name: path ? basename(path) : "Open repository",
				workspace: {
					...RepositoryWorkspaceModel.create(),
					repositoryPath: path,
					loading: path !== null,
					commitMessage: draft,
					...(navigation ? WorkspaceSession.restoreNavigation(navigation) : {}),
				},
			})),
			activeId: document.activeId,
			nextId: document.tabs.reduce(
				(next, tab) =>
					Math.max(next, Number(tab.id.slice("workspace-".length)) + 1),
				1
			),
		};
	}

	private static restoreNavigation(navigation: WorkspaceNavigation) {
		const { views } = RepositoryWorkspaceModel.create();

		return {
			view: navigation.view,
			restoreHistoryLimit: navigation.history
				? navigation.historyLimit
				: undefined,
			views: {
				changes: { ...views.changes, selectedId: navigation.changes },
				history: {
					...views.history,
					selectedId: navigation.history,
					files: { ...views.history.files, selectedId: navigation.historyFile },
				},
				stashes: {
					...views.stashes,
					selectedId: navigation.stashes,
					files: { ...views.stashes.files, selectedId: navigation.stashFile },
				},
			},
		};
	}
}

import { GuidedTour, type TourTips } from "../../guided-tour/guided-tour";
import { Keybinds, type KeybindOverrides } from "../../keybinds/keybinds";
import type { RepositoryFileLayout } from "../../repository-workspace/lib/repository-file-tree";
import {
	TypographyPreferences,
	type AppTypography,
} from "../../appearance-settings/app-typography";
import {
	WorkspaceSpaces,
	type WorkspaceSpace,
} from "../../spaces/workspace-spaces";
import { basename, isAbsolute } from "node:path";
import {
	RepositoryLibrary,
	type RepositoryLibraryPreferences,
} from "../../repository-discovery/repository-library";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryPreferences,
} from "../../repository-discovery/repository-discovery";
import type { AppAppearancePreference } from "../../../styles/tokens";
import {
	RepositoryColors,
	type RepositoryColorChoices,
} from "../../repository-appearance/repository-colors";
import {
	RepositoryPatterns,
	type RepositoryPatternChoices,
} from "../../repository-appearance/repository-patterns";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
import type { WorkspaceTabsState } from "./workspace-tabs-model";
import type { RepositoryView } from "../../repository-workspace/types";
import {
	defaultDiffSettings,
	type DiffSettings,
} from "../../repository-workspace/lib/repository-diff";

/** First-run progress, independent of repository history; older sessions remain complete. */
export type OnboardingStep =
	| "welcome"
	| "git"
	| "spaces"
	| "repository"
	| "complete";

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
	readonly spaces?: readonly WorkspaceSpace[];
	readonly activeSpaceId?: string;
	readonly tabs: readonly {
		readonly id: string;
		readonly spaceId?: string;
		readonly path: string | null;
		readonly draft: string;
		readonly navigation?: WorkspaceNavigation;
	}[];
	readonly activeId: string | null;
	readonly recentRepositories?: readonly string[];
	readonly repositoryDiscovery?: RepositoryDiscoveryPreferences;
	readonly repositoryLibrary?: RepositoryLibraryPreferences;
	readonly diffSettings?: DiffSettings;
	readonly fileListLayout?: RepositoryFileLayout;
	readonly appearance?: AppAppearancePreference;
	readonly commitTypeBadges?: boolean;
	readonly autoIncludeChanges?: boolean;
	readonly smoothTransitions?: boolean;
	readonly showScrollbars?: boolean;
	readonly showGrain?: boolean;
	readonly typography?: AppTypography;
	readonly repositoryColors?: RepositoryColorChoices;
	readonly repositoryPatterns?: RepositoryPatternChoices;
	readonly onboarding?: OnboardingStep;
	readonly tips?: TourTips;
	readonly keybinds?: KeybindOverrides;
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
			(view !== "changes" &&
				view !== "history" &&
				view !== "stashes" &&
				view !== "graph") ||
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

		const spaces = WorkspaceSpaces.parse(value.spaces);

		const activeSpaceId = spaces?.some(
			(space) => space.id === value.activeSpaceId
		)
			? String(value.activeSpaceId)
			: "default";

		const tabs: WorkspaceSessionDocument["tabs"][number][] = [];
		const ids = new Set<string>();

		for (const tab of value.tabs) {
			if (
				!isRecord(tab) ||
				typeof tab.id !== "string" ||
				!tabIdPattern.test(tab.id) ||
				!Number.isSafeInteger(Number(tab.id.slice("workspace-".length)) + 1) ||
				ids.has(tab.id) ||
				(tab.spaceId !== undefined &&
					(!spaces || !spaces.some((space) => space.id === tab.spaceId))) ||
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
				...(spaces
					? {
							spaceId:
								typeof tab.spaceId === "string" ? tab.spaceId : "default",
						}
					: {}),
				path: tab.path,
				draft: tab.draft,
				navigation: WorkspaceSession.navigation(tab.navigation),
			});
		}

		const tips = GuidedTour.parse(value.tips);
		const diffSettings = WorkspaceSession.diffSettings(value.diffSettings);
		const repositoryColors = RepositoryColors.parse(value.repositoryColors);

		const repositoryPatterns = RepositoryPatterns.parse(
			value.repositoryPatterns
		);

		const repositoryDiscovery = RepositoryDiscovery.preferences(
			value.repositoryDiscovery
		);

		const repositoryLibrary = RepositoryLibrary.preferences(
			value.repositoryLibrary
		);

		return {
			version: 1,
			...(spaces
				? {
						spaces: spaces.map((space) => ({
							...space,
							activeId: tabs.some(
								(tab) =>
									tab.id === space.activeId &&
									(tab.spaceId ?? "default") === space.id
							)
								? space.activeId
								: null,
						})),
						activeSpaceId,
					}
				: {}),
			...(!RepositoryLibrary.isDefault(repositoryLibrary)
				? { repositoryLibrary }
				: {}),
			tabs,
			...(value.appearance === "light" ||
			value.appearance === "dark" ||
			value.appearance === "system"
				? { appearance: value.appearance }
				: {}),
			...(typeof value.autoIncludeChanges === "boolean"
				? { autoIncludeChanges: value.autoIncludeChanges }
				: {}),
			...(typeof value.commitTypeBadges === "boolean"
				? { commitTypeBadges: value.commitTypeBadges }
				: {}),
			...(value.typography === undefined
				? {}
				: { typography: TypographyPreferences.parse(value.typography) }),
			...(typeof value.showGrain === "boolean"
				? { showGrain: value.showGrain }
				: {}),
			...(typeof value.showScrollbars === "boolean"
				? { showScrollbars: value.showScrollbars }
				: {}),
			...(value.fileListLayout === "list" || value.fileListLayout === "tree"
				? { fileListLayout: value.fileListLayout }
				: {}),
			...(typeof value.smoothTransitions === "boolean"
				? { smoothTransitions: value.smoothTransitions }
				: {}),
			...(value.onboarding === "welcome" ||
			value.onboarding === "git" ||
			value.onboarding === "spaces" ||
			value.onboarding === "repository" ||
			value.onboarding === "complete"
				? { onboarding: value.onboarding }
				: {}),
			...(tips ? { tips } : {}),
			...(value.keybinds === undefined
				? {}
				: { keybinds: Keybinds.parse(value.keybinds) }),
			...(diffSettings ? { diffSettings } : {}),
			...(Object.keys(repositoryColors).length ? { repositoryColors } : {}),
			...(Object.keys(repositoryPatterns).length ? { repositoryPatterns } : {}),
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
					: typeof value.activeId === "string" &&
						  tabs.some(
								(tab) =>
									tab.id === value.activeId &&
									(tab.spaceId ?? "default") === activeSpaceId
						  )
						? value.activeId
						: (tabs.find((tab) => (tab.spaceId ?? "default") === activeSpaceId)
								?.id ?? null),
		};
	}

	static capture(
		state: WorkspaceTabsState,
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
	): WorkspaceSessionDocument {
		return {
			version: 1,
			autoIncludeChanges: state.autoIncludeChanges ?? false,
			...(fileListLayout ? { fileListLayout } : {}),
			...(state.spaces
				? {
						spaces: state.spaces.map((space) =>
							space.id === (state.activeSpaceId ?? "default")
								? { ...space, activeId: state.activeId }
								: space
						),
						activeSpaceId: state.activeSpaceId ?? "default",
					}
				: {}),
			...(repositoryLibrary && !RepositoryLibrary.isDefault(repositoryLibrary)
				? { repositoryLibrary }
				: {}),
			...(appearance ? { appearance } : {}),
			...(commitTypeBadges !== undefined ? { commitTypeBadges } : {}),
			...(typography
				? { typography: TypographyPreferences.parse(typography) }
				: {}),
			...(showScrollbars !== undefined ? { showScrollbars } : {}),
			...(showGrain !== undefined ? { showGrain } : {}),
			...(smoothTransitions !== undefined ? { smoothTransitions } : {}),
			...(onboarding ? { onboarding } : {}),
			...(tips ? { tips } : {}),
			...(keybinds && Object.keys(keybinds).length ? { keybinds } : {}),
			...(diffSettings ? { diffSettings } : {}),
			...(repositoryDiscovery &&
			(repositoryDiscovery.folders.length || repositoryDiscovery.hidden.length)
				? { repositoryDiscovery }
				: {}),
			...(repositoryColors && Object.keys(repositoryColors).length
				? { repositoryColors }
				: {}),
			...(repositoryPatterns && Object.keys(repositoryPatterns).length
				? { repositoryPatterns }
				: {}),
			...(state.recentRepositories !== undefined
				? { recentRepositories: state.recentRepositories }
				: {}),
			tabs: state.tabs.map(({ id, spaceId, workspace }) => ({
				id,
				...(spaceId ? { spaceId } : {}),
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
			autoIncludeChanges: document.autoIncludeChanges ?? false,
			...(document.spaces
				? {
						spaces: document.spaces,
						activeSpaceId: document.activeSpaceId ?? "default",
					}
				: {}),
			recentRepositories: [
				...new Set(
					document.recentRepositories ??
						document.tabs.flatMap((tab) => (tab.path ? [tab.path] : []))
				),
			].slice(0, 100),
			tabs: document.tabs.map(({ id, spaceId, path, draft, navigation }) => ({
				id,
				...(spaceId ? { spaceId } : {}),
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

import {
	WorkspaceSpaces,
	type WorkspaceSpace,
	type WorkspaceSpaceAction,
} from "../../spaces/workspace-spaces";
import type { RepositorySnapshot } from "@1git/git";
import { basename } from "node:path";
import type { ComparisonRequest } from "../../repository-comparison/lib/repository-comparison";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
	type RepositoryWorkspaceAction,
} from "../../repository-workspace/lib/repository-workspace-model";

/** A workspace tab with presentation state and optional live repository metadata. */
export interface WorkspaceTabRecord {
	readonly spaceId?: string;
	readonly comparison?: ComparisonRequest;
	readonly id: string;
	readonly name: string;
	readonly branch?: string;
	readonly workspace: RepositoryWorkspaceState;
}

/** In-memory tabs and their active selection belong to one app instance. */
export interface WorkspaceTabsState {
	readonly spaces?: readonly WorkspaceSpace[];
	readonly activeSpaceId?: string;
	readonly preview: boolean;
	readonly tabs: readonly WorkspaceTabRecord[];
	readonly activeId: string | null;
	readonly nextId: number;
	readonly recentRepositories?: readonly string[];
	readonly autoIncludeChanges?: boolean;
}

/** Tab mutations are independent of the renderer and never perform filesystem work. */
export type WorkspaceTabsAction =
	| WorkspaceSpaceAction
	| { type: "auto-include-changes"; enabled: boolean }
	| { type: "home" }
	| { type: "add"; path?: string }
	| { type: "forget-repository"; path: string }
	| { type: "open-worktree"; snapshot: RepositorySnapshot; spaceId?: string }
	| { type: "worktree-removed"; path: string }
	| { type: "activate"; id: string }
	| { type: "compare"; id: string; comparison?: ComparisonRequest }
	| { type: "reorder"; id: string; overId: string }
	| { type: "workspace"; id: string; action: RepositoryWorkspaceAction }
	| { type: "close"; id: string };

/** Pure tab transitions; closing the active tab selects its right neighbor, then its left. */
export class WorkspaceTabsModel {
	private constructor() {}

	/** Seed workspaces; zero starts on Home and preview explicitly opts into sample data. */
	static create(initialTabCount = 1, preview = false): WorkspaceTabsState {
		if (!Number.isInteger(initialTabCount) || initialTabCount < 0) {
			throw new Error("Initial tab count must be a non-negative integer");
		}

		if (initialTabCount === 0)
			return { preview, tabs: [], activeId: null, nextId: 1 };

		let state: WorkspaceTabsState = {
			preview,
			tabs: [
				{
					id: "workspace-1",
					name: preview ? "1git" : "Open repository",
					branch: preview ? "main" : undefined,
					workspace: RepositoryWorkspaceModel.create(preview),
				},
			],
			activeId: "workspace-1",
			nextId: 2,
		};

		for (let index = 1; index < initialTabCount; index += 1) {
			state = WorkspaceTabsModel.reduce(state, { type: "add" });
		}

		return WorkspaceTabsModel.reduce(state, {
			type: "activate",
			id: "workspace-1",
		});
	}

	static reduce(
		state: WorkspaceTabsState,
		action: WorkspaceTabsAction
	): WorkspaceTabsState {
		if (
			action.type === "space-create" ||
			action.type === "space-select" ||
			action.type === "space-edit" ||
			action.type === "space-delete" ||
			action.type === "space-preferences"
		)
			return WorkspaceSpaces.reduce(state, action);

		return WorkspaceSpaces.remember(
			state,
			WorkspaceTabsModel.reduceTabs(state, action)
		);
	}

	private static reduceTabs(
		state: WorkspaceTabsState,
		action: Exclude<WorkspaceTabsAction, WorkspaceSpaceAction>
	): WorkspaceTabsState {
		if (action.type === "auto-include-changes")
			return { ...state, autoIncludeChanges: action.enabled };

		if (action.type === "home")
			return state.activeId === null ? state : { ...state, activeId: null };

		if (action.type === "forget-repository") {
			return {
				...state,
				spaces: state.spaces?.map((space) =>
					space.id === (state.activeSpaceId ?? "default")
						? {
								...space,
								repositories: space.repositories.filter(
									(path) => path !== action.path
								),
							}
						: space
				),
				recentRepositories: (state.recentRepositories ?? []).filter(
					(path) => path !== action.path
				),
			};
		}

		if (action.type === "worktree-removed") {
			const tabs = state.tabs.filter(
				(tab) =>
					(tab.workspace.repository?.root ?? tab.workspace.repositoryPath) !==
					action.path
			);

			return {
				...state,
				tabs,
				activeId:
					state.activeId === null ||
					tabs.some((tab) => tab.id === state.activeId)
						? state.activeId
						: (tabs.find(
								(tab) =>
									(tab.spaceId ?? "default") ===
									(state.activeSpaceId ?? "default")
							)?.id ?? null),
			};
		}

		if (action.type === "open-worktree") {
			const requestedOwner = action.spaceId ?? state.activeSpaceId ?? "default";

			// Worktree creation may finish after its originating space was deleted.
			const owner =
				state.spaces &&
				!state.spaces.some((space) => space.id === requestedOwner)
					? "default"
					: requestedOwner;

			const visible = owner === (state.activeSpaceId ?? "default");

			const existing = state.tabs.find(
				(tab) =>
					(tab.spaceId ?? "default") === owner &&
					tab.workspace.repository?.root === action.snapshot.repository.root
			);

			if (existing)
				return visible ? { ...state, activeId: existing.id } : state;

			const workspace = RepositoryWorkspaceModel.reduce(
				RepositoryWorkspaceModel.create(),
				{ type: "loaded", snapshot: action.snapshot },
				state.autoIncludeChanges
			);

			const tab: WorkspaceTabRecord = {
				...(state.spaces ? { spaceId: owner } : {}),
				id: `workspace-${state.nextId}`,
				name: workspace.repository?.name ?? "Workspace",
				branch: workspace.repository?.branch,
				workspace,
			};

			return {
				...state,
				tabs: [...state.tabs, tab],
				recentRepositories: WorkspaceTabsModel.remember(
					state.recentRepositories,
					workspace.repository?.root
				),
				activeId: visible ? tab.id : state.activeId,
				nextId: state.nextId + 1,
			};
		}

		if (action.type === "add") {
			const tab = {
				...(state.spaces ? { spaceId: state.activeSpaceId ?? "default" } : {}),
				id: `workspace-${state.nextId}`,
				name: action.path ? basename(action.path) : `Workspace ${state.nextId}`,
				workspace: {
					...RepositoryWorkspaceModel.create(state.preview),
					...(action.path
						? { repositoryPath: action.path, loading: true }
						: {}),
				},
			};

			return {
				...state,
				tabs: [...state.tabs, tab],
				activeId: tab.id,
				nextId: state.nextId + 1,
			};
		}

		const index = state.tabs.findIndex((tab) => tab.id === action.id);

		if (index === -1) return state;

		if (action.type === "compare")
			return {
				...state,
				tabs: state.tabs.map((tab) =>
					tab.id === action.id ? { ...tab, comparison: action.comparison } : tab
				),
			};

		if (action.type === "workspace") {
			const tab = state.tabs[index];

			if (!tab) return state;

			const workspace = RepositoryWorkspaceModel.reduce(
				tab.workspace,
				action.action,
				state.autoIncludeChanges
			);

			if (workspace === tab.workspace) return state;

			return {
				...state,
				recentRepositories:
					workspace.repository &&
					workspace.repository.root !== tab.workspace.repository?.root &&
					workspace.repository.root !== tab.workspace.repositoryPath
						? WorkspaceTabsModel.remember(
								state.recentRepositories,
								workspace.repository.root
							)
						: state.recentRepositories,
				tabs: state.tabs.map((item) =>
					item.id === tab.id
						? {
								...tab,
								workspace,
								name: workspace.repository?.name ?? tab.name,
								branch: workspace.repository?.branch ?? tab.branch,
							}
						: item
				),
			};
		}

		if (action.type === "activate") {
			if (
				(state.tabs[index]?.spaceId ?? "default") !==
				(state.activeSpaceId ?? "default")
			)
				return state;

			return state.activeId === action.id
				? state
				: { ...state, activeId: action.id };
		}

		if (action.type === "reorder") {
			const target = state.tabs.findIndex((tab) => tab.id === action.overId);
			const tab = state.tabs[index];

			if (
				!tab ||
				target < 0 ||
				target === index ||
				(tab.spaceId ?? "default") !==
					(state.tabs[target]?.spaceId ?? "default")
			)
				return state;

			const tabs = [...state.tabs];

			tabs.splice(index, 1);
			tabs.splice(target, 0, tab);

			return { ...state, tabs };
		}

		const closing = state.tabs[index];

		if (closing && RepositoryWorkspaceModel.isBusy(closing.workspace))
			return state;

		const tabs = state.tabs.filter((tab) => tab.id !== action.id);

		const visibleTabs = tabs.filter(
			(tab) => (tab.spaceId ?? "default") === (state.activeSpaceId ?? "default")
		);

		const visibleIndex = WorkspaceSpaces.tabs(state).findIndex(
			(tab) => tab.id === action.id
		);

		const activeId =
			state.activeId === action.id
				? ((visibleTabs[visibleIndex] ?? visibleTabs[visibleIndex - 1])?.id ??
					null)
				: state.activeId;

		return { ...state, tabs, activeId };
	}

	/** Keep a bounded local launch list without background repository reads. */
	static remember(
		paths: readonly string[] = [],
		path?: string
	): readonly string[] {
		return path
			? [path, ...paths.filter((item) => item !== path)].slice(0, 100)
			: paths;
	}

	static destination(
		tabs: readonly WorkspaceTabRecord[],
		id: string,
		key: string
	): string | undefined {
		const index = tabs.findIndex((tab) => tab.id === id);

		if (index === -1) return undefined;

		if (key === "home") return tabs[0]?.id;

		if (key === "end") return tabs.at(-1)?.id;

		if (key !== "left" && key !== "right") return undefined;

		const offset = key === "left" ? -1 : 1;

		return tabs[(index + offset + tabs.length) % tabs.length]?.id;
	}
}

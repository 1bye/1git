import { spaceIcons } from "./space-icons";
import { isAbsolute } from "node:path";
import {
	RepositoryDiscovery,
	type RepositoryDiscoveryPreferences,
} from "../repository-discovery/repository-discovery";
import {
	RepositoryLibrary,
	type RepositoryLibraryPreferences,
} from "../repository-discovery/repository-library";
import type {
	WorkspaceTabsState,
	WorkspaceTabRecord,
} from "../workspace-tabs/lib/workspace-tabs-model";

/** A saved working context. Repository membership never moves or copies files. */
export interface WorkspaceSpace {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly color?: string;
	readonly activeId: string | null;
	readonly repositories: readonly string[];
	readonly discovery: RepositoryDiscoveryPreferences;
	readonly library: RepositoryLibraryPreferences;
}

/** Space order follows the saved switcher menu; navigation stops at either end. */
export type SpaceDirection = "previous" | "next";

/** Space transitions share the tab reducer so asynchronous work retains its original owner. */
export type WorkspaceSpaceAction =
	| {
			type: "space-create";
			space: Pick<
				WorkspaceSpace,
				"id" | "name" | "icon" | "color" | "repositories"
			>;
			discovery: RepositoryDiscoveryPreferences;
			library: RepositoryLibraryPreferences;
	  }
	| { type: "space-select"; id: string }
	| { type: "space-delete"; id: string }
	| {
			type: "space-edit";
			id: string;
			name: string;
			icon: string;
			color?: string;
	  }
	| {
			type: "space-preferences";
			id: string;
			discovery?:
				| RepositoryDiscoveryPreferences
				| ((
						current: RepositoryDiscoveryPreferences
				  ) => RepositoryDiscoveryPreferences);
			library?:
				| RepositoryLibraryPreferences
				| ((
						current: RepositoryLibraryPreferences
				  ) => RepositoryLibraryPreferences);
	  };

const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Pure space validation, migration and tab ownership. Default stays implicit until another space exists. */
export class WorkspaceSpaces {
	static destination(
		spaces: readonly WorkspaceSpace[],
		activeId: string,
		direction: SpaceDirection
	): string | null {
		const index = spaces.findIndex((space) => space.id === activeId);

		if (index < 0) return null;

		return spaces[index + (direction === "next" ? 1 : -1)]?.id ?? null;
	}

	static initialize(
		state: WorkspaceTabsState,
		discovery: RepositoryDiscoveryPreferences,
		library: RepositoryLibraryPreferences
	): WorkspaceTabsState {
		return state.spaces
			? state
			: {
					...state,
					activeSpaceId: "default",
					spaces: [
						{
							id: "default",
							name: "Default",
							icon: "layers",
							activeId: state.activeId,
							repositories: this.paths([
								...(state.recentRepositories ?? []),
								...state.tabs.flatMap(
									(tab) =>
										tab.workspace.repository?.root ??
										tab.workspace.repositoryPath ??
										[]
								),
							]),
							discovery,
							library,
						},
					],
				};
	}

	static color(value: unknown): string | undefined {
		return typeof value === "string" && /^#[a-f0-9]{6}$/iu.test(value)
			? value.toLowerCase()
			: undefined;
	}

	static validIcon(icon: string): boolean {
		return (
			spaceIcons.some((value) => value === icon) ||
			(icon.length <= 32 &&
				emoji.test(icon) &&
				[...segmenter.segment(icon)].length === 1)
		);
	}

	static validName(name: string): boolean {
		return (
			!!name.trim() &&
			name.trim().length <= 60 &&
			!Array.from(name).some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
			)
		);
	}

	static paths(value: unknown): readonly string[] {
		if (!Array.isArray(value)) return [];

		return [
			...new Set(
				value.filter(
					(path): path is string =>
						typeof path === "string" &&
						isAbsolute(path) &&
						!/[\0\r\n]/.test(path)
				)
			),
		].slice(0, 5000);
	}

	static parse(value: unknown): readonly WorkspaceSpace[] | undefined {
		if (value === undefined) return undefined;

		if (!Array.isArray(value) || !value.length || value.length > 50)
			throw new Error("The saved spaces are invalid.");

		const ids = new Set<string>();

		const spaces = value.map((item: unknown): WorkspaceSpace => {
			if (typeof item !== "object" || item === null)
				throw new Error("The saved space is invalid.");

			const record = item as Record<string, unknown>;

			if (
				typeof record.id !== "string" ||
				!/^(default|[a-f0-9-]{36})$/.test(record.id) ||
				ids.has(record.id) ||
				typeof record.name !== "string" ||
				!this.validName(record.name) ||
				typeof record.icon !== "string" ||
				!this.validIcon(record.icon) ||
				!(record.activeId === null || typeof record.activeId === "string")
			)
				throw new Error("The saved space is invalid.");

			ids.add(record.id);

			return {
				id: record.id,
				name: record.name.trim(),
				icon: record.icon,
				...(this.color(record.color)
					? { color: this.color(record.color) }
					: {}),
				activeId: record.activeId,
				repositories: this.paths(record.repositories),
				discovery: RepositoryDiscovery.preferences(record.discovery),
				library: RepositoryLibrary.preferences(record.library),
			};
		});

		if (!ids.has("default"))
			throw new Error("The saved Default space is missing.");

		return spaces;
	}

	static current(state: WorkspaceTabsState): WorkspaceSpace | undefined {
		return state.spaces?.find(
			(space) => space.id === (state.activeSpaceId ?? "default")
		);
	}

	static tabs(state: WorkspaceTabsState): readonly WorkspaceTabRecord[] {
		return state.tabs.filter(
			(tab) => (tab.spaceId ?? "default") === (state.activeSpaceId ?? "default")
		);
	}

	static reduce(
		state: WorkspaceTabsState,
		action: WorkspaceSpaceAction
	): WorkspaceTabsState {
		if (action.type === "space-create") {
			if (
				!/^[a-f0-9-]{36}$/.test(action.space.id) ||
				!this.validName(action.space.name) ||
				!this.validIcon(action.space.icon) ||
				state.spaces?.some((space) => space.id === action.space.id) ||
				(state.spaces?.length ?? 1) >= 50
			)
				return state;

			const spaces =
				this.initialize(state, action.discovery, action.library).spaces ?? [];

			return {
				...state,
				activeId: null,
				activeSpaceId: action.space.id,
				spaces: [
					...spaces.map((space) =>
						space.id === (state.activeSpaceId ?? "default")
							? { ...space, activeId: state.activeId }
							: space
					),
					{
						...action.space,
						name: action.space.name.trim(),
						color: this.color(action.space.color),
						repositories: this.paths(action.space.repositories),
						activeId: null,
						discovery: { folders: [], hidden: [] },
						library: { starred: [], view: "tiles" },
					},
				],
			};
		}

		const target = state.spaces?.find((space) => space.id === action.id);

		if (!target) return state;

		if (action.type === "space-delete") {
			if (target.id === "default") return state;

			const deletingActive = target.id === state.activeSpaceId;

			return {
				...state,
				activeSpaceId: deletingActive ? "default" : state.activeSpaceId,
				tabs: state.tabs.map((tab) =>
					tab.spaceId === target.id ? { ...tab, spaceId: "default" } : tab
				),
				spaces: state.spaces
					?.filter((space) => space.id !== target.id)
					.map((space) =>
						space.id === "default"
							? {
									...space,
									activeId: deletingActive ? state.activeId : space.activeId,
									repositories: this.paths([
										...space.repositories,
										...target.repositories,
									]),
								}
							: space
					),
			};
		}

		if (action.type === "space-select") {
			if (action.id === (state.activeSpaceId ?? "default")) return state;

			return {
				...state,
				spaces: state.spaces?.map((space) =>
					space.id === (state.activeSpaceId ?? "default")
						? { ...space, activeId: state.activeId }
						: space
				),
				activeSpaceId: action.id,
				activeId: state.tabs.some(
					(tab) =>
						tab.id === target.activeId &&
						(tab.spaceId ?? "default") === target.id
				)
					? target.activeId
					: null,
			};
		}

		if (
			action.type === "space-edit" &&
			(!this.validName(action.name) || !this.validIcon(action.icon))
		)
			return state;

		return {
			...state,
			spaces: state.spaces?.map((space) =>
				space.id !== target.id
					? space
					: action.type === "space-edit"
						? {
								...space,
								name: action.name.trim(),
								icon: action.icon,
								color: this.color(action.color),
							}
						: {
								...space,
								...(action.discovery
									? {
											discovery:
												typeof action.discovery === "function"
													? action.discovery(space.discovery)
													: action.discovery,
										}
									: {}),
								...(action.library
									? {
											library:
												typeof action.library === "function"
													? action.library(space.library)
													: action.library,
										}
									: {}),
							}
			),
		};
	}

	/** Record open repositories in their own space, including late background results after a switch. */
	static remember(
		previous: WorkspaceTabsState,
		state: WorkspaceTabsState
	): WorkspaceTabsState {
		if (!state.spaces) return state;

		const previousPaths = new Map(
			previous.tabs.map((tab) => [
				tab.id,
				tab.workspace.repository?.root ?? tab.workspace.repositoryPath,
			])
		);

		let changed = false;

		const spaces = state.spaces.map((space) => {
			const added = state.tabs.flatMap((tab) => {
				const path =
					tab.workspace.repository?.root ?? tab.workspace.repositoryPath;

				return (tab.spaceId ?? "default") === space.id &&
					path &&
					previousPaths.get(tab.id) !== path &&
					!space.repositories.includes(path)
					? [path]
					: [];
			});

			if (!added.length) return space;

			changed = true;

			return {
				...space,
				repositories: this.paths([...space.repositories, ...added]),
			};
		});

		return changed ? { ...state, spaces } : state;
	}
}

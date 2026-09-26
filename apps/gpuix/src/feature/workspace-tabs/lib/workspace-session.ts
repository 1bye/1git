import { basename, isAbsolute } from "node:path";
import { RepositoryWorkspaceModel } from "../../repository-workspace/lib/repository-workspace-model";
import type { WorkspaceTabsState } from "./workspace-tabs-model";

/** Versioned local session intent; never contains Git snapshots, credentials or pending operations. */
export interface WorkspaceSessionDocument {
	readonly version: 1;
	readonly tabs: readonly {
		readonly id: string;
		readonly path: string | null;
		readonly draft: string;
	}[];
	readonly activeId: string | null;
}

const tabIdPattern = /^workspace-([1-9]\d*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Projects persistent tab intent into fresh, disconnected workspaces for read-only restoration. */
export class WorkspaceSession {
	private constructor() {}

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
			tabs.push({ id: tab.id, path: tab.path, draft: tab.draft });
		}

		return {
			version: 1,
			tabs,
			activeId:
				typeof value.activeId === "string" && ids.has(value.activeId)
					? value.activeId
					: (tabs[0]?.id ?? null),
		};
	}

	static capture(state: WorkspaceTabsState): WorkspaceSessionDocument {
		return {
			version: 1,
			tabs: state.tabs.map(({ id, workspace }) => ({
				id,
				path: workspace.repository?.root ?? workspace.repositoryPath,
				draft: workspace.commitMessage,
			})),
			activeId: state.activeId,
		};
	}

	static restore(document: WorkspaceSessionDocument): WorkspaceTabsState {
		return {
			preview: false,
			tabs: document.tabs.map(({ id, path, draft }) => ({
				id,
				name: path ? basename(path) : "Open repository",
				workspace: {
					...RepositoryWorkspaceModel.create(),
					repositoryPath: path,
					loading: path !== null,
					commitMessage: draft,
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
}

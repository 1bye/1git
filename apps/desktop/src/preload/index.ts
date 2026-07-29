import { contextBridge, ipcRenderer } from "electron";
import {
	type DesktopApi,
	type DesktopGitApi,
	GIT_IPC_CHANNELS,
} from "../shared/git-ipc.js";
import type { RepositorySessionId } from "../shared/repository-session.js";

const sessionRequest = (sessionId: RepositorySessionId) => ({ sessionId });

const inputRequest = <TInput>(
	sessionId: RepositorySessionId,
	input: TInput
) => ({
	input,
	sessionId,
});

const gitApi: DesktopGitApi = {
	branches: {
		abortMerge: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.abortMerge,
				sessionRequest(sessionId)
			),
		abortRebase: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.abortRebase,
				sessionRequest(sessionId)
			),
		checkout: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.checkout,
				inputRequest(sessionId, input)
			),
		continueRebase: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.continueRebase,
				sessionRequest(sessionId)
			),
		create: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.create,
				inputRequest(sessionId, input)
			),
		delete: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.delete,
				inputRequest(sessionId, input)
			),
		list: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.list,
				sessionRequest(sessionId)
			),
		merge: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.merge,
				inputRequest(sessionId, input)
			),
		rebase: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.rebase,
				inputRequest(sessionId, input)
			),
		rename: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.rename,
				inputRequest(sessionId, input)
			),
		setUpstream: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.setUpstream,
				inputRequest(sessionId, input)
			),
		skipRebase: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.branches.skipRebase,
				sessionRequest(sessionId)
			),
	},
	changes: {
		commit: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.commit,
				inputRequest(sessionId, input)
			),
		reset: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.reset,
				inputRequest(sessionId, input)
			),
		restore: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.restore,
				inputRequest(sessionId, input)
			),
		stage: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.stage,
				inputRequest(sessionId, input)
			),
		stageAll: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.stageAll,
				sessionRequest(sessionId)
			),
		unstage: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.unstage,
				inputRequest(sessionId, input)
			),
		unstageAll: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.changes.unstageAll,
				sessionRequest(sessionId)
			),
	},
	config: {
		get: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.config.get,
				inputRequest(sessionId, input)
			),
		set: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.config.set,
				inputRequest(sessionId, input)
			),
		unset: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.config.unset,
				inputRequest(sessionId, input)
			),
	},
	remotes: {
		add: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.remotes.add,
				inputRequest(sessionId, input)
			),
		list: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.remotes.list,
				sessionRequest(sessionId)
			),
		remove: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.remotes.remove,
				inputRequest(sessionId, input)
			),
		rename: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.remotes.rename,
				inputRequest(sessionId, input)
			),
		setUrl: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.remotes.setUrl,
				inputRequest(sessionId, input)
			),
	},
	repository: {
		diff: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.repository.diff,
				inputRequest(sessionId, input)
			),
		fileContent: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.repository.fileContent,
				inputRequest(sessionId, input)
			),
		getCommit: async (sessionId, revision) =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.repository.getCommit, {
				revision,
				sessionId,
			}),
		history: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.repository.history,
				inputRequest(sessionId, input)
			),
		snapshot: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.repository.snapshot,
				inputRequest(sessionId, input)
			),
	},
	sequences: {
		abortCherryPick: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.abortCherryPick,
				sessionRequest(sessionId)
			),
		abortRevert: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.abortRevert,
				sessionRequest(sessionId)
			),
		cherryPick: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.cherryPick,
				inputRequest(sessionId, input)
			),
		continueCherryPick: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.continueCherryPick,
				sessionRequest(sessionId)
			),
		continueRevert: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.continueRevert,
				sessionRequest(sessionId)
			),
		revert: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sequences.revert,
				inputRequest(sessionId, input)
			),
	},
	sessions: {
		activate: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sessions.activate,
				sessionRequest(sessionId)
			),
		clone: async (input) =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.sessions.clone, input),
		close: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sessions.close,
				sessionRequest(sessionId)
			),
		forgetRecent: async (path) =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.sessions.forgetRecent, {
				path,
			}),
		initialize: async (input) =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.sessions.initialize, input),
		open: async (input) =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.sessions.open, input),
		state: async () =>
			await ipcRenderer.invoke(GIT_IPC_CHANNELS.sessions.state),
	},
	stashes: {
		apply: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.stashes.apply,
				inputRequest(sessionId, input)
			),
		create: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.stashes.create,
				inputRequest(sessionId, input)
			),
		drop: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.stashes.drop,
				inputRequest(sessionId, input)
			),
		list: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.stashes.list,
				sessionRequest(sessionId)
			),
		pop: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.stashes.pop,
				inputRequest(sessionId, input)
			),
	},
	sync: {
		fetch: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sync.fetch,
				inputRequest(sessionId, input)
			),
		pull: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sync.pull,
				inputRequest(sessionId, input)
			),
		push: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.sync.push,
				inputRequest(sessionId, input)
			),
	},
	tags: {
		create: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.tags.create,
				inputRequest(sessionId, input)
			),
		delete: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.tags.delete,
				inputRequest(sessionId, input)
			),
		list: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.tags.list,
				sessionRequest(sessionId)
			),
	},
	worktrees: {
		create: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.create,
				inputRequest(sessionId, input)
			),
		list: async (sessionId) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.list,
				sessionRequest(sessionId)
			),
		lock: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.lock,
				inputRequest(sessionId, input)
			),
		move: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.move,
				inputRequest(sessionId, input)
			),
		prune: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.prune,
				inputRequest(sessionId, input)
			),
		remove: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.remove,
				inputRequest(sessionId, input)
			),
		repair: async (sessionId, input = {}) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.repair,
				inputRequest(sessionId, input)
			),
		unlock: async (sessionId, input) =>
			await ipcRenderer.invoke(
				GIT_IPC_CHANNELS.worktrees.unlock,
				inputRequest(sessionId, input)
			),
	},
};

const desktopApi: DesktopApi = {
	git: gitApi,
	platform: process.platform,
};

contextBridge.exposeInMainWorld("desktop", desktopApi);

import type { IpcRenderer } from "electron";
import {
	type DesktopGitApi,
	GIT_IPC_CHANNELS,
	GIT_IPC_EVENTS,
	type GitOperationOptions,
	isRepositoryRefreshEvent,
} from "../shared/git-ipc.js";
import type { RepositorySessionId } from "../shared/repository-session.js";

export type DesktopIpcInvoke = IpcRenderer["invoke"];
export type DesktopIpcSubscribe = (
	channel: string,
	listener: (payload: unknown) => void
) => () => void;

const operationId = (options?: GitOperationOptions): string =>
	options?.operationId ?? globalThis.crypto.randomUUID();

const sessionRequest = (
	sessionId: RepositorySessionId,
	options?: GitOperationOptions
) => ({
	operationId: operationId(options),
	sessionId,
});

const inputRequest = <TInput>(
	sessionId: RepositorySessionId,
	input: TInput,
	options?: GitOperationOptions
) => ({
	input,
	operationId: operationId(options),
	sessionId,
});

const creationRequest = <TInput>(
	input: TInput,
	options?: GitOperationOptions
) => ({
	...input,
	operationId: operationId(options),
});

export const createDesktopGitApi = (
	invoke: DesktopIpcInvoke,
	subscribe: DesktopIpcSubscribe
): DesktopGitApi => ({
	branches: {
		abortMerge: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.abortMerge,
				sessionRequest(sessionId, options)
			),
		abortRebase: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.abortRebase,
				sessionRequest(sessionId, options)
			),
		checkout: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.checkout,
				inputRequest(sessionId, input, options)
			),
		continueRebase: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.continueRebase,
				sessionRequest(sessionId, options)
			),
		create: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.create,
				inputRequest(sessionId, input, options)
			),
		delete: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.delete,
				inputRequest(sessionId, input, options)
			),
		list: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.list,
				sessionRequest(sessionId, options)
			),
		merge: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.merge,
				inputRequest(sessionId, input, options)
			),
		rebase: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.rebase,
				inputRequest(sessionId, input, options)
			),
		rename: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.rename,
				inputRequest(sessionId, input, options)
			),
		setUpstream: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.setUpstream,
				inputRequest(sessionId, input, options)
			),
		skipRebase: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.branches.skipRebase,
				sessionRequest(sessionId, options)
			),
	},
	changes: {
		changeHunk: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.changeHunk,
				inputRequest(sessionId, input, options)
			),
		commit: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.commit,
				inputRequest(sessionId, input, options)
			),
		discardFiles: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.discardFiles,
				inputRequest(sessionId, input, options)
			),
		reset: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.reset,
				inputRequest(sessionId, input, options)
			),
		restore: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.restore,
				inputRequest(sessionId, input, options)
			),
		stage: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.stage,
				inputRequest(sessionId, input, options)
			),
		stageAll: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.stageAll,
				sessionRequest(sessionId, options)
			),
		undoDiscard: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.undoDiscard,
				inputRequest(sessionId, input, options)
			),
		unstage: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.unstage,
				inputRequest(sessionId, input, options)
			),
		unstageAll: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.changes.unstageAll,
				sessionRequest(sessionId, options)
			),
	},
	config: {
		get: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.config.get,
				inputRequest(sessionId, input, options)
			),
		set: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.config.set,
				inputRequest(sessionId, input, options)
			),
		unset: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.config.unset,
				inputRequest(sessionId, input, options)
			),
	},
	events: {
		onRepositoryRefresh: (listener) =>
			subscribe(GIT_IPC_EVENTS.repositoryRefresh, (payload) => {
				if (isRepositoryRefreshEvent(payload)) {
					listener(payload);
				}
			}),
	},
	operations: {
		cancel: async (id) =>
			await invoke(GIT_IPC_CHANNELS.operations.cancel, {
				operationId: id,
			}),
		createId: () => globalThis.crypto.randomUUID(),
	},
	remotes: {
		add: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.remotes.add,
				inputRequest(sessionId, input, options)
			),
		list: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.remotes.list,
				sessionRequest(sessionId, options)
			),
		remove: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.remotes.remove,
				inputRequest(sessionId, input, options)
			),
		rename: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.remotes.rename,
				inputRequest(sessionId, input, options)
			),
		setUrl: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.remotes.setUrl,
				inputRequest(sessionId, input, options)
			),
	},
	repository: {
		diff: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.repository.diff,
				inputRequest(sessionId, input, options)
			),
		fileContent: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.repository.fileContent,
				inputRequest(sessionId, input, options)
			),
		getCommit: async (sessionId, revision, options) =>
			await invoke(GIT_IPC_CHANNELS.repository.getCommit, {
				operationId: operationId(options),
				revision,
				sessionId,
			}),
		history: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.repository.history,
				inputRequest(sessionId, input, options)
			),
		snapshot: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.repository.snapshot,
				inputRequest(sessionId, input, options)
			),
	},
	sequences: {
		abortCherryPick: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.abortCherryPick,
				sessionRequest(sessionId, options)
			),
		abortRevert: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.abortRevert,
				sessionRequest(sessionId, options)
			),
		cherryPick: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.cherryPick,
				inputRequest(sessionId, input, options)
			),
		continueCherryPick: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.continueCherryPick,
				sessionRequest(sessionId, options)
			),
		continueRevert: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.continueRevert,
				sessionRequest(sessionId, options)
			),
		revert: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sequences.revert,
				inputRequest(sessionId, input, options)
			),
	},
	sessions: {
		activate: async (sessionId) =>
			await invoke(GIT_IPC_CHANNELS.sessions.activate, {
				sessionId,
			}),
		clone: async (input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sessions.clone,
				creationRequest(input, options)
			),
		close: async (sessionId) =>
			await invoke(GIT_IPC_CHANNELS.sessions.close, { sessionId }),
		forgetRecent: async (path) =>
			await invoke(GIT_IPC_CHANNELS.sessions.forgetRecent, {
				path,
			}),
		initialize: async (input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sessions.initialize,
				creationRequest(input, options)
			),
		open: async (input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sessions.open,
				creationRequest(input, options)
			),
		pickDirectory: async () =>
			await invoke(GIT_IPC_CHANNELS.sessions.pickDirectory),
		preview: async (input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.sessions.preview,
				creationRequest(input, options)
			),
		state: async () => await invoke(GIT_IPC_CHANNELS.sessions.state),
	},
	stashes: {
		apply: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.stashes.apply,
				inputRequest(sessionId, input, options)
			),
		create: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.stashes.create,
				inputRequest(sessionId, input, options)
			),
		drop: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.stashes.drop,
				inputRequest(sessionId, input, options)
			),
		list: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.stashes.list,
				sessionRequest(sessionId, options)
			),
		pop: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.stashes.pop,
				inputRequest(sessionId, input, options)
			),
	},
	sync: {
		fetch: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.sync.fetch,
				inputRequest(sessionId, input, options)
			),
		pull: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.sync.pull,
				inputRequest(sessionId, input, options)
			),
		push: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.sync.push,
				inputRequest(sessionId, input, options)
			),
	},
	tags: {
		create: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.tags.create,
				inputRequest(sessionId, input, options)
			),
		delete: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.tags.delete,
				inputRequest(sessionId, input, options)
			),
		list: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.tags.list,
				sessionRequest(sessionId, options)
			),
	},
	worktrees: {
		create: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.create,
				inputRequest(sessionId, input, options)
			),
		list: async (sessionId, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.list,
				sessionRequest(sessionId, options)
			),
		lock: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.lock,
				inputRequest(sessionId, input, options)
			),
		move: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.move,
				inputRequest(sessionId, input, options)
			),
		prune: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.prune,
				inputRequest(sessionId, input, options)
			),
		remove: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.remove,
				inputRequest(sessionId, input, options)
			),
		repair: async (sessionId, input = {}, options?) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.repair,
				inputRequest(sessionId, input, options)
			),
		unlock: async (sessionId, input, options) =>
			await invoke(
				GIT_IPC_CHANNELS.worktrees.unlock,
				inputRequest(sessionId, input, options)
			),
	},
});

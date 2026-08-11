import type {
	AddRemoteInput,
	ChangeHunkInput,
	CheckoutBranchInput,
	CloneRepositoryInput,
	CommitInput,
	CreateBranchInput,
	CreateTagInput,
	CreateWorktreeInput,
	DeleteBranchInput,
	DeleteTagInput,
	DiffInput,
	DiscardFilesInput,
	DropStashInput,
	FetchInput,
	FileContentInput,
	GetConfigInput,
	GitOperation,
	GitRepository,
	GitResult,
	HistoryInput,
	InitializeRepositoryInput,
	LockWorktreeInput,
	MergeInput,
	MoveWorktreeInput,
	PruneWorktreesInput,
	PullInput,
	PushInput,
	RebaseInput,
	RemoveRemoteInput,
	RemoveWorktreeInput,
	RenameBranchInput,
	RenameRemoteInput,
	RepairWorktreesInput,
	ResetInput,
	RestoreInput,
	RevertInput,
	RevisionSequenceInput,
	SetConfigInput,
	SetRemoteUrlInput,
	SetUpstreamInput,
	SnapshotInput,
	StageInput,
	StashInput,
	StashReferenceInput,
	UndoDiscardInput,
	WorktreePathInput,
} from "@1git/git";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
	GIT_IPC_CHANNELS,
	type GitOperationId,
	type IpcGitInput,
	type IpcRepositoryCreationInput,
	type OpenRepositoryIpcInput,
	repositoryMutationOperationForChannel,
} from "../../shared/git-ipc.js";
import type {
	OpenedRepositorySession,
	RepositoryDirectorySelection,
	RepositoryManagerResult,
	RepositorySessionId,
} from "../../shared/repository-session.js";
import type { GitOperationRegistry } from "./git-operation-registry.js";
import { publishRepositoryMutation } from "./repository-events.js";
import type { RepositoryManager } from "./repository-manager.js";

const UNAUTHORIZED_IPC_MESSAGE = "Unauthorized Git IPC sender.";

type IpcMainRegistration = Pick<IpcMain, "handle" | "removeHandler">;

interface GitIpcContext {
	readonly operationRegistry: GitOperationRegistry;
	readonly owner: IpcMainInvokeEvent["sender"];
}

type GitIpcHandler = (
	payload: unknown,
	context: GitIpcContext
) => Promise<unknown> | unknown;

interface GitIpcHandlerRegistration {
	readonly channel: string;
	readonly handle: GitIpcHandler;
}

interface GitSessionIpcRequest {
	readonly operationId?: GitOperationId;
	readonly sessionId: RepositorySessionId;
}

interface GitSessionInputIpcRequest<TInput> extends GitSessionIpcRequest {
	readonly input: TInput;
}

interface GitSessionRevisionIpcRequest extends GitSessionIpcRequest {
	readonly revision: string;
}

interface GitOperationIpcRequest {
	readonly operationId: GitOperationId;
}

interface RegisterGitIpcOptions {
	readonly ipcMain: IpcMainRegistration;
	readonly isSenderAuthorized: (event: IpcMainInvokeEvent) => boolean;
	readonly operationRegistry: GitOperationRegistry;
	readonly pickRepositoryDirectory?: (
		owner: IpcMainInvokeEvent["sender"]
	) => Promise<RepositoryDirectorySelection>;
	readonly repositoryManager: RepositoryManager;
}

class InvalidIpcRequest extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidIpcRequest";
	}
}

const requireRecord = (
	value: unknown,
	label: string
): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new InvalidIpcRequest(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
};

const requireString = (
	record: Readonly<Record<string, unknown>>,
	key: string
): string => {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new InvalidIpcRequest(`${key} must be a non-empty string.`);
	}
	return value;
};

const rendererSafeInput = (
	input: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
	const safeInput: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (key !== "operationId" && key !== "runtime" && key !== "signal") {
			safeInput[key] = value;
		}
	}
	return safeInput;
};

const parseOptionalOperationId = (payload: unknown): string | undefined => {
	const request = requireRecord(payload, "Git IPC request");
	if (request.operationId === undefined) {
		return;
	}
	return requireString(request, "operationId");
};

const parseOperationRequest = (payload: unknown): GitOperationIpcRequest => {
	const request = requireRecord(payload, "Cancel operation input");
	return { operationId: requireString(request, "operationId") };
};

const parseSessionRequest = (payload: unknown): GitSessionIpcRequest => {
	const request = requireRecord(payload, "Git IPC request");
	return { sessionId: requireString(request, "sessionId") };
};

const parseSessionInputRequest = <TInput>(
	payload: unknown
): GitSessionInputIpcRequest<TInput> => {
	const request = requireRecord(payload, "Git IPC request");
	const input = rendererSafeInput(
		requireRecord(request.input, "Git IPC input")
	);
	return {
		input: input as TInput,
		sessionId: requireString(request, "sessionId"),
	};
};

const parseRevisionRequest = (
	payload: unknown
): GitSessionRevisionIpcRequest => {
	const request = requireRecord(payload, "Git IPC request");
	return {
		revision: requireString(request, "revision"),
		sessionId: requireString(request, "sessionId"),
	};
};

const invalidGitRequest = <T>(
	operation: GitOperation,
	error: InvalidIpcRequest
): GitResult<T> => ({
	error: {
		code: "invalid-input",
		message: error.message,
		operation,
		retryable: false,
	},
	ok: false,
});

const runOperation = async <T>(
	payload: unknown,
	context: GitIpcContext,
	operation: GitOperation,
	task: (signal: AbortSignal) => Promise<GitResult<T>>
): Promise<GitResult<T>> => {
	try {
		return await context.operationRegistry.run({
			operation,
			operationId: parseOptionalOperationId(payload),
			owner: context.owner,
			task,
		});
	} catch (error: unknown) {
		if (error instanceof InvalidIpcRequest) {
			return invalidGitRequest(operation, error);
		}
		throw error;
	}
};

const repositoryHandler =
	<T>(
		repositoryManager: RepositoryManager,
		operation: GitOperation,
		task: (
			repository: GitRepository,
			signal: AbortSignal
		) => Promise<GitResult<T>>
	): GitIpcHandler =>
	async (payload, context): Promise<GitResult<T>> =>
		await runOperation(payload, context, operation, async (signal) => {
			const { sessionId } = parseSessionRequest(payload);
			return await repositoryManager.performRepositoryOperation(
				sessionId,
				operation,
				async (repository) => await task(repository, signal)
			);
		});

const repositoryInputHandler =
	<TInput extends object, T>(
		repositoryManager: RepositoryManager,
		operation: GitOperation,
		task: (repository: GitRepository, input: TInput) => Promise<GitResult<T>>
	): GitIpcHandler =>
	async (payload, context): Promise<GitResult<T>> =>
		await runOperation(payload, context, operation, async (signal) => {
			const { input, sessionId } = parseSessionInputRequest<TInput>(payload);
			return await repositoryManager.performRepositoryOperation(
				sessionId,
				operation,
				async (repository) => await task(repository, { ...input, signal })
			);
		});

const repositoryRevisionHandler =
	<T>(
		repositoryManager: RepositoryManager,
		operation: GitOperation,
		task: (
			repository: GitRepository,
			revision: string,
			signal: AbortSignal
		) => Promise<GitResult<T>>
	): GitIpcHandler =>
	async (payload, context): Promise<GitResult<T>> =>
		await runOperation(payload, context, operation, async (signal) => {
			const { revision, sessionId } = parseRevisionRequest(payload);
			return await repositoryManager.performRepositoryOperation(
				sessionId,
				operation,
				async (repository) => await task(repository, revision, signal)
			);
		});

const gitResultFromManager = (
	result: RepositoryManagerResult<OpenedRepositorySession>,
	operation: "clone-repository" | "initialize-repository" | "open-repository"
): GitResult<OpenedRepositorySession> => {
	if (result.ok) {
		return result;
	}
	if (result.error.code === "git-error") {
		return { error: result.error.gitError, ok: false };
	}
	return {
		error: {
			code: "command-failed",
			message: result.error.message,
			operation,
			retryable: false,
		},
		ok: false,
	};
};

const parseOpenInput = (payload: unknown): OpenRepositoryIpcInput => {
	const input = requireRecord(payload, "Open repository input");
	const { activate } = input;
	if (activate !== undefined && typeof activate !== "boolean") {
		throw new InvalidIpcRequest("activate must be a boolean.");
	}
	return {
		activate,
		path: requireString(input, "path"),
	};
};

const parseCreationInput = <TInput>(
	payload: unknown,
	requiredKeys: readonly string[]
): TInput => {
	const input = rendererSafeInput(
		requireRecord(payload, "Repository creation input")
	);
	for (const key of requiredKeys) {
		requireString(input, key);
	}
	return input as TInput;
};

const sessionHandlers = (
	repositoryManager: RepositoryManager,
	pickRepositoryDirectory: (
		owner: IpcMainInvokeEvent["sender"]
	) => Promise<RepositoryDirectorySelection>
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.sessions.pickDirectory,
		handle: async (_payload, context) =>
			await pickRepositoryDirectory(context.owner),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.state,
		handle: () => repositoryManager.getState(),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.open,
		handle: async (payload, context) =>
			await runOperation(
				payload,
				context,
				"open-repository",
				async (signal) => {
					const result = await repositoryManager.openRepository({
						...parseOpenInput(payload),
						signal,
					});
					return gitResultFromManager(result, "open-repository");
				}
			),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.preview,
		handle: async (payload, context) =>
			await runOperation(
				payload,
				context,
				"open-repository",
				async (signal) =>
					await repositoryManager.previewRepository({
						...parseOpenInput(payload),
						signal,
					})
			),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.initialize,
		handle: async (payload, context) =>
			await runOperation(
				payload,
				context,
				"initialize-repository",
				async (signal) => {
					const input = parseCreationInput<
						IpcRepositoryCreationInput<InitializeRepositoryInput>
					>(payload, ["path"]);
					const result = await repositoryManager.initializeRepository({
						...input,
						signal,
					});
					return gitResultFromManager(result, "initialize-repository");
				}
			),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.clone,
		handle: async (payload, context) =>
			await runOperation(
				payload,
				context,
				"clone-repository",
				async (signal) => {
					const input = parseCreationInput<
						IpcRepositoryCreationInput<CloneRepositoryInput>
					>(payload, ["path", "remoteUrl"]);
					const result = await repositoryManager.cloneRepository({
						...input,
						signal,
					});
					return gitResultFromManager(result, "clone-repository");
				}
			),
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.activate,
		handle: (payload) => {
			const { sessionId } = parseSessionRequest(payload);
			return repositoryManager.activateSession(sessionId);
		},
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.close,
		handle: (payload) => {
			const { sessionId } = parseSessionRequest(payload);
			return repositoryManager.closeSession(sessionId);
		},
	},
	{
		channel: GIT_IPC_CHANNELS.sessions.forgetRecent,
		handle: (payload) => {
			const request = requireRecord(payload, "Forget recent input");
			return repositoryManager.forgetRecentRepository(
				requireString(request, "path")
			);
		},
	},
];

const operationHandlers = (): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.operations.cancel,
		handle: (payload, context) => {
			const { operationId } = parseOperationRequest(payload);
			return context.operationRegistry.cancel(operationId, context.owner);
		},
	},
];

const repositoryHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.repository.snapshot,
		handle: repositoryInputHandler(
			repositoryManager,
			"get-snapshot",
			async (repository, input: IpcGitInput<SnapshotInput>) =>
				await repository.getSnapshot(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.repository.history,
		handle: repositoryInputHandler(
			repositoryManager,
			"get-history",
			async (repository, input: IpcGitInput<HistoryInput>) =>
				await repository.getHistory(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.repository.getCommit,
		handle: repositoryRevisionHandler(
			repositoryManager,
			"get-commit",
			async (repository, revision, signal) =>
				await repository.getCommit(revision, { signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.repository.diff,
		handle: repositoryInputHandler(
			repositoryManager,
			"diff",
			async (repository, input: IpcGitInput<DiffInput>) =>
				await repository.getDiff(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.repository.fileContent,
		handle: repositoryInputHandler(
			repositoryManager,
			"file-content",
			async (repository, input: IpcGitInput<FileContentInput>) =>
				await repository.getFileContent(input)
		),
	},
];

const changeHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.changes.changeHunk,
		handle: repositoryInputHandler(
			repositoryManager,
			"change-hunk",
			async (repository, input: IpcGitInput<ChangeHunkInput>) =>
				await repository.changeHunk(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.discardFiles,
		handle: repositoryInputHandler(
			repositoryManager,
			"discard-files",
			async (repository, input: IpcGitInput<DiscardFilesInput>) =>
				await repository.discardFiles(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.stage,
		handle: repositoryInputHandler(
			repositoryManager,
			"stage",
			async (repository, input: IpcGitInput<StageInput>) =>
				await repository.stage(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.stageAll,
		handle: repositoryHandler(
			repositoryManager,
			"stage-all",
			async (repository, signal) => await repository.stageAll({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.unstage,
		handle: repositoryInputHandler(
			repositoryManager,
			"unstage",
			async (repository, input: IpcGitInput<StageInput>) =>
				await repository.unstage(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.unstageAll,
		handle: repositoryHandler(
			repositoryManager,
			"unstage-all",
			async (repository, signal) => await repository.unstageAll({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.undoDiscard,
		handle: repositoryInputHandler(
			repositoryManager,
			"undo-discard",
			async (repository, input: IpcGitInput<UndoDiscardInput>) =>
				await repository.undoDiscard(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.restore,
		handle: repositoryInputHandler(
			repositoryManager,
			"restore",
			async (repository, input: IpcGitInput<RestoreInput>) =>
				await repository.restore(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.reset,
		handle: repositoryInputHandler(
			repositoryManager,
			"reset",
			async (repository, input: IpcGitInput<ResetInput>) =>
				await repository.reset(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.changes.commit,
		handle: repositoryInputHandler(
			repositoryManager,
			"commit",
			async (repository, input: IpcGitInput<CommitInput>) =>
				await repository.commit(input)
		),
	},
];

const branchHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.branches.list,
		handle: repositoryHandler(
			repositoryManager,
			"get-branches",
			async (repository, signal) => await repository.getBranches({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.create,
		handle: repositoryInputHandler(
			repositoryManager,
			"create-branch",
			async (repository, input: IpcGitInput<CreateBranchInput>) =>
				await repository.createBranch(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.checkout,
		handle: repositoryInputHandler(
			repositoryManager,
			"checkout-branch",
			async (repository, input: IpcGitInput<CheckoutBranchInput>) =>
				await repository.checkoutBranch(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.rename,
		handle: repositoryInputHandler(
			repositoryManager,
			"rename-branch",
			async (repository, input: IpcGitInput<RenameBranchInput>) =>
				await repository.renameBranch(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.delete,
		handle: repositoryInputHandler(
			repositoryManager,
			"delete-branch",
			async (repository, input: IpcGitInput<DeleteBranchInput>) =>
				await repository.deleteBranch(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.setUpstream,
		handle: repositoryInputHandler(
			repositoryManager,
			"set-upstream",
			async (repository, input: IpcGitInput<SetUpstreamInput>) =>
				await repository.setUpstream(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.merge,
		handle: repositoryInputHandler(
			repositoryManager,
			"merge",
			async (repository, input: IpcGitInput<MergeInput>) =>
				await repository.merge(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.abortMerge,
		handle: repositoryHandler(
			repositoryManager,
			"abort-merge",
			async (repository, signal) => await repository.abortMerge({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.continueMerge,
		handle: repositoryHandler(
			repositoryManager,
			"continue-merge",
			async (repository, signal) => await repository.continueMerge({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.rebase,
		handle: repositoryInputHandler(
			repositoryManager,
			"rebase",
			async (repository, input: IpcGitInput<RebaseInput>) =>
				await repository.rebase(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.continueRebase,
		handle: repositoryHandler(
			repositoryManager,
			"continue-rebase",
			async (repository, signal) => await repository.continueRebase({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.skipRebase,
		handle: repositoryHandler(
			repositoryManager,
			"skip-rebase",
			async (repository, signal) => await repository.skipRebase({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.branches.abortRebase,
		handle: repositoryHandler(
			repositoryManager,
			"abort-rebase",
			async (repository, signal) => await repository.abortRebase({ signal })
		),
	},
];

const sequenceHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.sequences.cherryPick,
		handle: repositoryInputHandler(
			repositoryManager,
			"cherry-pick",
			async (repository, input: IpcGitInput<RevisionSequenceInput>) =>
				await repository.cherryPick(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sequences.continueCherryPick,
		handle: repositoryHandler(
			repositoryManager,
			"continue-cherry-pick",
			async (repository, signal) =>
				await repository.continueCherryPick({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sequences.abortCherryPick,
		handle: repositoryHandler(
			repositoryManager,
			"abort-cherry-pick",
			async (repository, signal) => await repository.abortCherryPick({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sequences.revert,
		handle: repositoryInputHandler(
			repositoryManager,
			"revert",
			async (repository, input: IpcGitInput<RevertInput>) =>
				await repository.revert(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sequences.continueRevert,
		handle: repositoryHandler(
			repositoryManager,
			"continue-revert",
			async (repository, signal) => await repository.continueRevert({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sequences.abortRevert,
		handle: repositoryHandler(
			repositoryManager,
			"abort-revert",
			async (repository, signal) => await repository.abortRevert({ signal })
		),
	},
];

const tagHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.tags.list,
		handle: repositoryHandler(
			repositoryManager,
			"get-tags",
			async (repository, signal) => await repository.getTags({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.tags.create,
		handle: repositoryInputHandler(
			repositoryManager,
			"create-tag",
			async (repository, input: IpcGitInput<CreateTagInput>) =>
				await repository.createTag(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.tags.delete,
		handle: repositoryInputHandler(
			repositoryManager,
			"delete-tag",
			async (repository, input: IpcGitInput<DeleteTagInput>) =>
				await repository.deleteTag(input)
		),
	},
];

const remoteHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.remotes.list,
		handle: repositoryHandler(
			repositoryManager,
			"get-remotes",
			async (repository, signal) => await repository.getRemotes({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.remotes.add,
		handle: repositoryInputHandler(
			repositoryManager,
			"add-remote",
			async (repository, input: IpcGitInput<AddRemoteInput>) =>
				await repository.addRemote(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.remotes.rename,
		handle: repositoryInputHandler(
			repositoryManager,
			"rename-remote",
			async (repository, input: IpcGitInput<RenameRemoteInput>) =>
				await repository.renameRemote(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.remotes.setUrl,
		handle: repositoryInputHandler(
			repositoryManager,
			"set-remote-url",
			async (repository, input: IpcGitInput<SetRemoteUrlInput>) =>
				await repository.setRemoteUrl(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.remotes.remove,
		handle: repositoryInputHandler(
			repositoryManager,
			"remove-remote",
			async (repository, input: IpcGitInput<RemoveRemoteInput>) =>
				await repository.removeRemote(input)
		),
	},
];

const syncHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.sync.fetch,
		handle: repositoryInputHandler(
			repositoryManager,
			"fetch",
			async (repository, input: IpcGitInput<FetchInput>) =>
				await repository.fetch(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sync.pull,
		handle: repositoryInputHandler(
			repositoryManager,
			"pull",
			async (repository, input: IpcGitInput<PullInput>) =>
				await repository.pull(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.sync.push,
		handle: repositoryInputHandler(
			repositoryManager,
			"push",
			async (repository, input: IpcGitInput<PushInput>) =>
				await repository.push(input)
		),
	},
];

const stashHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.stashes.list,
		handle: repositoryHandler(
			repositoryManager,
			"get-stashes",
			async (repository, signal) => await repository.getStashes({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.stashes.create,
		handle: repositoryInputHandler(
			repositoryManager,
			"stash",
			async (repository, input: IpcGitInput<StashInput>) =>
				await repository.stash(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.stashes.apply,
		handle: repositoryInputHandler(
			repositoryManager,
			"apply-stash",
			async (repository, input: IpcGitInput<StashReferenceInput>) =>
				await repository.applyStash(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.stashes.pop,
		handle: repositoryInputHandler(
			repositoryManager,
			"pop-stash",
			async (repository, input: IpcGitInput<StashReferenceInput>) =>
				await repository.popStash(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.stashes.drop,
		handle: repositoryInputHandler(
			repositoryManager,
			"drop-stash",
			async (repository, input: IpcGitInput<DropStashInput>) =>
				await repository.dropStash(input)
		),
	},
];

const worktreeHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.worktrees.list,
		handle: repositoryHandler(
			repositoryManager,
			"get-worktrees",
			async (repository, signal) => await repository.getWorktrees({ signal })
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.create,
		handle: repositoryInputHandler(
			repositoryManager,
			"create-worktree",
			async (repository, input: IpcGitInput<CreateWorktreeInput>) =>
				await repository.createWorktree(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.move,
		handle: repositoryInputHandler(
			repositoryManager,
			"move-worktree",
			async (repository, input: IpcGitInput<MoveWorktreeInput>) =>
				await repository.moveWorktree(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.remove,
		handle: repositoryInputHandler(
			repositoryManager,
			"remove-worktree",
			async (repository, input: IpcGitInput<RemoveWorktreeInput>) =>
				await repository.removeWorktree(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.lock,
		handle: repositoryInputHandler(
			repositoryManager,
			"lock-worktree",
			async (repository, input: IpcGitInput<LockWorktreeInput>) =>
				await repository.lockWorktree(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.unlock,
		handle: repositoryInputHandler(
			repositoryManager,
			"unlock-worktree",
			async (repository, input: IpcGitInput<WorktreePathInput>) =>
				await repository.unlockWorktree(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.prune,
		handle: repositoryInputHandler(
			repositoryManager,
			"prune-worktrees",
			async (repository, input: IpcGitInput<PruneWorktreesInput>) =>
				await repository.pruneWorktrees(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.worktrees.repair,
		handle: repositoryInputHandler(
			repositoryManager,
			"repair-worktrees",
			async (repository, input: IpcGitInput<RepairWorktreesInput>) =>
				await repository.repairWorktrees(input)
		),
	},
];

const configHandlers = (
	repositoryManager: RepositoryManager
): readonly GitIpcHandlerRegistration[] => [
	{
		channel: GIT_IPC_CHANNELS.config.get,
		handle: repositoryInputHandler(
			repositoryManager,
			"get-config",
			async (repository, input: IpcGitInput<GetConfigInput>) =>
				await repository.getConfig(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.config.set,
		handle: repositoryInputHandler(
			repositoryManager,
			"set-config",
			async (repository, input: IpcGitInput<SetConfigInput>) =>
				await repository.setConfig(input)
		),
	},
	{
		channel: GIT_IPC_CHANNELS.config.unset,
		handle: repositoryInputHandler(
			repositoryManager,
			"unset-config",
			async (repository, input: IpcGitInput<GetConfigInput>) =>
				await repository.unsetConfig(input)
		),
	},
];

const allHandlers = (
	repositoryManager: RepositoryManager,
	pickRepositoryDirectory: (
		owner: IpcMainInvokeEvent["sender"]
	) => Promise<RepositoryDirectorySelection>
): readonly GitIpcHandlerRegistration[] => [
	...sessionHandlers(repositoryManager, pickRepositoryDirectory),
	...operationHandlers(),
	...repositoryHandlers(repositoryManager),
	...changeHandlers(repositoryManager),
	...branchHandlers(repositoryManager),
	...sequenceHandlers(repositoryManager),
	...tagHandlers(repositoryManager),
	...remoteHandlers(repositoryManager),
	...syncHandlers(repositoryManager),
	...stashHandlers(repositoryManager),
	...worktreeHandlers(repositoryManager),
	...configHandlers(repositoryManager),
];

const resultMayHaveChangedRepository = (result: unknown): boolean => {
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		return false;
	}
	const resultRecord = result as Readonly<Record<string, unknown>>;
	if (resultRecord.ok === true) {
		return true;
	}
	if (
		resultRecord.ok !== false ||
		!resultRecord.error ||
		typeof resultRecord.error !== "object" ||
		Array.isArray(resultRecord.error)
	) {
		return false;
	}
	const error = resultRecord.error as Readonly<Record<string, unknown>>;
	return error.code === "command-failed" || error.code === "conflict";
};

const openedSessionId = (result: unknown): RepositorySessionId | undefined => {
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		return;
	}
	const resultRecord = result as Readonly<Record<string, unknown>>;
	if (
		resultRecord.ok !== true ||
		!resultRecord.value ||
		typeof resultRecord.value !== "object" ||
		Array.isArray(resultRecord.value)
	) {
		return;
	}
	const value = resultRecord.value as Readonly<Record<string, unknown>>;
	if (
		!value.session ||
		typeof value.session !== "object" ||
		Array.isArray(value.session)
	) {
		return;
	}
	const session = value.session as Readonly<Record<string, unknown>>;
	return typeof session.id === "string" && session.id.length > 0
		? session.id
		: undefined;
};

const mutationSessionId = (
	channel: string,
	payload: unknown,
	result: unknown,
	repositoryManager: RepositoryManager
): RepositorySessionId | undefined => {
	if (
		channel === GIT_IPC_CHANNELS.sessions.clone ||
		channel === GIT_IPC_CHANNELS.sessions.initialize
	) {
		return openedSessionId(result);
	}

	try {
		const { sessionId } = parseSessionRequest(payload);
		return repositoryManager.getSession(sessionId).ok ? sessionId : undefined;
	} catch (error: unknown) {
		if (error instanceof InvalidIpcRequest) {
			return;
		}
		throw error;
	}
};

/** Registers every concrete Git method and returns an idempotent disposer. */
export const registerGitIpc = ({
	ipcMain,
	isSenderAuthorized,
	operationRegistry,
	pickRepositoryDirectory = () =>
		Promise.resolve({ status: "cancelled" } as const),
	repositoryManager,
}: RegisterGitIpcOptions): (() => void) => {
	const handlers = allHandlers(repositoryManager, pickRepositoryDirectory);
	for (const { channel, handle } of handlers) {
		ipcMain.handle(channel, async (event, payload: unknown) => {
			if (!isSenderAuthorized(event)) {
				throw new Error(UNAUTHORIZED_IPC_MESSAGE);
			}
			const result = await handle(payload, {
				operationRegistry,
				owner: event.sender,
			});
			const operation = repositoryMutationOperationForChannel(channel);
			if (
				operation &&
				resultMayHaveChangedRepository(result) &&
				!event.sender.isDestroyed()
			) {
				const sessionId = mutationSessionId(
					channel,
					payload,
					result,
					repositoryManager
				);
				if (sessionId) {
					const operationId = parseOptionalOperationId(payload);
					publishRepositoryMutation(event.sender, {
						operation,
						...(operationId ? { operationId } : {}),
						sessionId,
					});
				}
			}
			return result;
		});
	}

	let disposed = false;
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		operationRegistry.abortAll();
		for (const { channel } of handlers) {
			ipcMain.removeHandler(channel);
		}
	};
};

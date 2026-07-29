import type { GitOperation, GitResult } from "@1git/git";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { registerGitIpc } from "../../src/main/git/git-ipc.js";
import { GitOperationRegistry } from "../../src/main/git/git-operation-registry.js";
import type { RepositoryManager } from "../../src/main/git/repository-manager.js";

type RegisteredIpcHandler = Parameters<IpcMain["handle"]>[1];

export class GitIpcHarness {
	private readonly authorizedSender = {};
	private readonly disposeRegistration: () => void;
	private readonly handlers = new Map<string, RegisteredIpcHandler>();
	readonly operationRegistry = new GitOperationRegistry();
	readonly repositoryManager: RepositoryManager;

	constructor(repositoryManager: RepositoryManager) {
		this.repositoryManager = repositoryManager;
		const ipcMain: Pick<IpcMain, "handle" | "removeHandler"> = {
			handle: (channel, listener) => {
				if (this.handlers.has(channel)) {
					throw new Error(`Duplicate IPC handler for "${channel}".`);
				}
				this.handlers.set(channel, listener);
			},
			removeHandler: (channel) => {
				this.handlers.delete(channel);
			},
		};
		this.disposeRegistration = registerGitIpc({
			ipcMain,
			isSenderAuthorized: (event) =>
				event.sender === (this.authorizedSender as WebContents),
			operationRegistry: this.operationRegistry,
			repositoryManager,
		});
	}

	get registeredChannels(): readonly string[] {
		return [...this.handlers.keys()];
	}

	async invoke<T>(channel: string, payload?: unknown): Promise<T> {
		return await this.invokeWithSender<T>(
			channel,
			this.authorizedSender,
			payload
		);
	}

	async invokeUnauthorized<T>(channel: string, payload?: unknown): Promise<T> {
		return await this.invokeWithSender<T>(channel, {}, payload);
	}

	dispose(): void {
		this.disposeRegistration();
	}

	async runTrackedOperation<T>(
		operationId: string,
		operation: GitOperation,
		task: (signal: AbortSignal) => Promise<GitResult<T>>
	): Promise<GitResult<T>> {
		return await this.operationRegistry.run({
			operation,
			operationId,
			owner: this.authorizedSender,
			task,
		});
	}

	private async invokeWithSender<T>(
		channel: string,
		sender: object,
		payload: unknown
	): Promise<T> {
		const handler = this.handlers.get(channel);
		if (!handler) {
			throw new Error(`No IPC handler registered for "${channel}".`);
		}
		const event = {
			sender,
		} as unknown as IpcMainInvokeEvent;
		return (await handler(event, payload)) as T;
	}
}

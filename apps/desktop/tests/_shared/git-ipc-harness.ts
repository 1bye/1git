import type { GitOperation, GitResult } from "@1git/git";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import { registerGitIpc } from "../../src/main/git/git-ipc.js";
import { GitOperationRegistry } from "../../src/main/git/git-operation-registry.js";
import type { RepositoryManager } from "../../src/main/git/repository-manager.js";
import type { RepositoryDirectorySelection } from "../../src/shared/repository-session.js";

type RegisteredIpcHandler = Parameters<IpcMain["handle"]>[1];

export interface SentRendererMessage {
	readonly channel: string;
	readonly payload: unknown;
}

export interface GitIpcHarnessOptions {
	readonly pickRepositoryDirectory?: () => Promise<RepositoryDirectorySelection>;
}

export class GitIpcHarness {
	private readonly messages: SentRendererMessage[] = [];
	private readonly rendererListeners = new Map<
		string,
		Set<(payload: unknown) => void>
	>();
	private readonly authorizedSender = {
		isDestroyed: () => false,
		send: (channel: string, payload: unknown) => {
			this.messages.push({ channel, payload });

			for (const listener of this.rendererListeners.get(channel) ?? []) {
				listener(payload);
			}
		},
	};
	private readonly disposeRegistration: () => void;
	private readonly handlers = new Map<string, RegisteredIpcHandler>();
	readonly operationRegistry = new GitOperationRegistry();
	readonly repositoryManager: RepositoryManager;

	constructor(
		repositoryManager: RepositoryManager,
		options: GitIpcHarnessOptions = {}
	) {
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
			pickRepositoryDirectory: options.pickRepositoryDirectory,
			repositoryManager,
		});
	}

	get registeredChannels(): readonly string[] {
		return [...this.handlers.keys()];
	}

	get sentRendererMessages(): readonly SentRendererMessage[] {
		return [...this.messages];
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
		this.rendererListeners.clear();
	}

	subscribeRenderer(
		channel: string,
		listener: (payload: unknown) => void
	): () => void {
		const listeners = this.rendererListeners.get(channel) ?? new Set();

		listeners.add(listener);
		this.rendererListeners.set(channel, listeners);

		return () => {
			listeners.delete(listener);

			if (listeners.size === 0) {
				this.rendererListeners.delete(channel);
			}
		};
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

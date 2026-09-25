import type { RepositoryManager } from "../../src/main/git/repository-manager.js";
import {
	createDesktopGitApi,
	type DesktopIpcSubscribe,
} from "../../src/preload/git-api.js";
import type { DesktopIpcInvoke } from "../../src/preload/ipc.js";
import type { DesktopGitApi } from "../../src/shared/git-ipc.js";
import { GitIpcHarness, type GitIpcHarnessOptions } from "./git-ipc-harness.js";

/** Connects the typed preload API to registered main-process IPC handlers. */
export class DesktopGitBridgeHarness {
	readonly api: DesktopGitApi;
	readonly ipc: GitIpcHarness;

	constructor(
		repositoryManager: RepositoryManager,
		options: GitIpcHarnessOptions = {}
	) {
		this.ipc = new GitIpcHarness(repositoryManager, options);
		const invoke: DesktopIpcInvoke = async (channel, payload) =>
			await this.ipc.invoke(channel, payload);

		const subscribe: DesktopIpcSubscribe = (channel, listener) =>
			this.ipc.subscribeRenderer(channel, listener);

		this.api = createDesktopGitApi(invoke, subscribe);
	}

	dispose(): void {
		this.ipc.dispose();
	}

	async invokeRaw<T>(channel: string, payload?: unknown): Promise<T> {
		return await this.ipc.invoke<T>(channel, payload);
	}
}

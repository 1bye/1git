import type { IpcMainInvokeEvent } from "electron";
import {
	REPOSITORY_OWNER_IPC_CHANNELS,
	type RepositoryOwnerAvatarResult,
} from "../../shared/repository-owner-avatar.js";

const GITHUB_HOST = "github.com";
const UNAUTHORIZED_IPC_MESSAGE = "Unauthorized repository owner IPC sender.";

interface IpcMainRegistration {
	readonly handle: (
		channel: string,
		listener: (
			event: IpcMainInvokeEvent,
			payload: unknown
		) => Promise<RepositoryOwnerAvatarResult>
	) => void;
	readonly removeHandler: (channel: string) => void;
}

interface RepositoryOwnerAvatarProvider {
	readonly get: (name: string) => Promise<RepositoryOwnerAvatarResult>;
}

interface RegisterRepositoryOwnerIpcOptions {
	readonly avatarProvider: RepositoryOwnerAvatarProvider;
	readonly ipcMain: IpcMainRegistration;
	readonly isSenderAuthorized: (event: IpcMainInvokeEvent) => boolean;
}

const unavailableResult = (): RepositoryOwnerAvatarResult => ({
	status: "unavailable",
});

const parseGithubOwnerName = (payload: unknown): string | null => {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const { host, name } = payload as Readonly<Record<string, unknown>>;
	if (
		typeof host !== "string" ||
		host.trim().toLowerCase() !== GITHUB_HOST ||
		typeof name !== "string" ||
		name.trim().length === 0
	) {
		return null;
	}
	return name.trim();
};

export const registerRepositoryOwnerIpc = ({
	avatarProvider,
	ipcMain,
	isSenderAuthorized,
}: RegisterRepositoryOwnerIpcOptions): (() => void) => {
	ipcMain.handle(
		REPOSITORY_OWNER_IPC_CHANNELS.avatar,
		async (event, payload) => {
			if (!isSenderAuthorized(event)) {
				throw new Error(UNAUTHORIZED_IPC_MESSAGE);
			}
			const ownerName = parseGithubOwnerName(payload);
			return ownerName
				? await avatarProvider.get(ownerName)
				: unavailableResult();
		}
	);

	let disposed = false;
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		ipcMain.removeHandler(REPOSITORY_OWNER_IPC_CHANNELS.avatar);
	};
};

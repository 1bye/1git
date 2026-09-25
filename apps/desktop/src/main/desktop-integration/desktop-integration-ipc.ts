import { isAbsolute } from "node:path";

import type { IpcMainInvokeEvent } from "electron";

import {
	DESKTOP_INTEGRATION_IPC_CHANNELS,
	type DesktopApplication,
} from "../../shared/desktop-integration.js";

const MAXIMUM_COPY_TEXT_LENGTH = 100_000;
const UNAUTHORIZED_IPC_MESSAGE = "Unauthorized desktop integration IPC sender.";
const DESKTOP_APPLICATIONS = new Set<DesktopApplication>(["ghostty", "zed"]);

interface IpcMainRegistration {
	readonly handle: (
		channel: string,
		listener: (event: IpcMainInvokeEvent, payload: unknown) => Promise<void>
	) => void;
	readonly removeHandler: (channel: string) => void;
}

export interface DesktopIntegrationOperations {
	readonly copyText: (text: string) => void;
	readonly openExternal: (url: string) => Promise<void>;
	readonly openInApplication: (
		application: DesktopApplication,
		path: string
	) => Promise<void>;
	readonly revealPath: (path: string) => void;
}

interface RegisterDesktopIntegrationIpcOptions {
	readonly ipcMain: IpcMainRegistration;
	readonly isSenderAuthorized: (event: IpcMainInvokeEvent) => boolean;
	readonly operations: DesktopIntegrationOperations;
}

const requireRecord = (
	payload: unknown,
	label: string
): Readonly<Record<string, unknown>> => {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return payload as Readonly<Record<string, unknown>>;
};

const requireString = (
	record: Readonly<Record<string, unknown>>,
	property: string
): string => {
	const value = record[property];
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`${property} must be a non-empty string.`);
	}
	return value;
};

const requireRepositoryPath = (payload: unknown): string => {
	const request = requireRecord(payload, "Repository path input");
	const path = requireString(request, "path");
	if (!isAbsolute(path) || path.includes("\0")) {
		throw new TypeError("path must be an absolute filesystem path.");
	}
	return path;
};

const requireExternalUrl = (payload: unknown): string => {
	const request = requireRecord(payload, "External URL input");
	const value = requireString(request, "url");
	if (!URL.canParse(value)) {
		throw new TypeError("url must be a valid HTTPS URL.");
	}
	const url = new URL(value);
	if (url.protocol !== "https:") {
		throw new TypeError("url must be a valid HTTPS URL.");
	}
	return url.toString();
};

const requireCopyText = (payload: unknown): string => {
	const request = requireRecord(payload, "Copy text input");
	const text = requireString(request, "text");
	if (text.length > MAXIMUM_COPY_TEXT_LENGTH) {
		throw new TypeError("text exceeds the maximum copy length.");
	}
	return text;
};

const requireApplication = (
	request: Readonly<Record<string, unknown>>
): DesktopApplication => {
	const application = requireString(request, "application");
	if (!DESKTOP_APPLICATIONS.has(application as DesktopApplication)) {
		throw new TypeError("application is not supported.");
	}
	return application as DesktopApplication;
};

export const registerDesktopIntegrationIpc = ({
	ipcMain,
	isSenderAuthorized,
	operations,
}: RegisterDesktopIntegrationIpcOptions): (() => void) => {
	const register = (
		channel: string,
		handle: (payload: unknown) => Promise<void> | void
	): void => {
		ipcMain.handle(channel, async (event, payload) => {
			if (!isSenderAuthorized(event)) {
				throw new Error(UNAUTHORIZED_IPC_MESSAGE);
			}
			await handle(payload);
		});
	};

	register(DESKTOP_INTEGRATION_IPC_CHANNELS.copyText, (payload) => {
		operations.copyText(requireCopyText(payload));
	});
	register(DESKTOP_INTEGRATION_IPC_CHANNELS.openExternal, async (payload) => {
		await operations.openExternal(requireExternalUrl(payload));
	});
	register(
		DESKTOP_INTEGRATION_IPC_CHANNELS.openInApplication,
		async (payload) => {
			const request = requireRecord(payload, "Open in application input");
			const application = requireApplication(request);
			const path = requireRepositoryPath(request);
			await operations.openInApplication(application, path);
		}
	);
	register(DESKTOP_INTEGRATION_IPC_CHANNELS.revealPath, (payload) => {
		operations.revealPath(requireRepositoryPath(payload));
	});

	const channels = Object.values(DESKTOP_INTEGRATION_IPC_CHANNELS);
	let disposed = false;
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		for (const channel of channels) {
			ipcMain.removeHandler(channel);
		}
	};
};

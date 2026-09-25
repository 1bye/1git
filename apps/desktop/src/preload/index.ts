import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

import type { DesktopApi } from "../shared/desktop-api.js";
import { createDesktopIntegrationApi } from "./desktop-integration-api.js";
import { createDesktopGitApi, type DesktopIpcSubscribe } from "./git-api.js";
import { createRepositoryOwnerApi } from "./repository-owner-api.js";

const subscribe: DesktopIpcSubscribe = (channel, listener) => {
	const handleEvent = (_event: IpcRendererEvent, payload: unknown): void => {
		listener(payload);
	};
	ipcRenderer.on(channel, handleEvent);
	return () => ipcRenderer.removeListener(channel, handleEvent);
};

const desktopApi: DesktopApi = {
	git: createDesktopGitApi(
		async (channel, payload) => await ipcRenderer.invoke(channel, payload),
		subscribe
	),
	integrations: createDesktopIntegrationApi(
		async (channel, payload) => await ipcRenderer.invoke(channel, payload)
	),
	platform: process.platform,
	repositoryOwners: createRepositoryOwnerApi(
		async (channel, payload) => await ipcRenderer.invoke(channel, payload)
	),
};

contextBridge.exposeInMainWorld("desktop", desktopApi);

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/git-ipc.js";
import { createDesktopGitApi, type DesktopIpcSubscribe } from "./git-api.js";

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
	platform: process.platform,
};

contextBridge.exposeInMainWorld("desktop", desktopApi);

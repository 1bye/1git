import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/git-ipc.js";
import { createDesktopGitApi } from "./git-api.js";

const desktopApi: DesktopApi = {
	git: createDesktopGitApi(
		async (channel, payload) => await ipcRenderer.invoke(channel, payload)
	),
	platform: process.platform,
};

contextBridge.exposeInMainWorld("desktop", desktopApi);

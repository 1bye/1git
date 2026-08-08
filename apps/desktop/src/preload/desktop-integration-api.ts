import {
	DESKTOP_INTEGRATION_IPC_CHANNELS,
	type DesktopApplication,
	type DesktopIntegrationApi,
} from "../shared/desktop-integration.js";
import type { DesktopIpcInvoke } from "./ipc.js";

export const createDesktopIntegrationApi = (
	invoke: DesktopIpcInvoke
): DesktopIntegrationApi => ({
	copyText: async (text) =>
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.copyText, { text }),
	openExternal: async (url) =>
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openExternal, { url }),
	openInApplication: async (application: DesktopApplication, path: string) =>
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openInApplication, {
			application,
			path,
		}),
	revealPath: async (path) =>
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.revealPath, { path }),
});

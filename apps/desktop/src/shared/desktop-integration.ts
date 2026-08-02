export const DESKTOP_INTEGRATION_IPC_CHANNELS = {
	copyText: "desktop-integration:copy-text",
	openExternal: "desktop-integration:open-external",
	openInApplication: "desktop-integration:open-in-application",
	revealPath: "desktop-integration:reveal-path",
} as const;

export type DesktopApplication = "ghostty" | "zed";

export interface DesktopIntegrationApi {
	readonly copyText: (text: string) => Promise<void>;
	readonly openExternal: (url: string) => Promise<void>;
	readonly openInApplication: (
		application: DesktopApplication,
		path: string
	) => Promise<void>;
	readonly revealPath: (path: string) => Promise<void>;
}

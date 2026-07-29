/// <reference types="vite/client" />

import type { DesktopApi } from "../../shared/git-ipc.js";

declare global {
	interface Window {
		readonly desktop: DesktopApi;
	}
}

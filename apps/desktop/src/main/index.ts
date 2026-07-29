import { join } from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	nativeTheme,
	shell,
} from "electron";
import { RepositoryManager } from "./git/repository-manager.js";

const MAIN_WINDOW_WIDTH = 1280;
const MAIN_WINDOW_HEIGHT = 820;
const MINIMUM_WINDOW_WIDTH = 980;
const MINIMUM_WINDOW_HEIGHT = 640;
const MACOS_TRAFFIC_LIGHT_X = 16;
const MACOS_TRAFFIC_LIGHT_Y = 17;
const repositoryManager = new RepositoryManager();

const platformWindowOptions = (): BrowserWindowConstructorOptions => {
	if (process.platform !== "darwin") {
		return {};
	}

	return {
		titleBarStyle: "hiddenInset",
		trafficLightPosition: {
			x: MACOS_TRAFFIC_LIGHT_X,
			y: MACOS_TRAFFIC_LIGHT_Y,
		},
		vibrancy: "sidebar",
		visualEffectState: "active",
	};
};

const secureNavigation = (window: BrowserWindow): void => {
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) {
			shell.openExternal(url).catch((error: unknown) => {
				const failure = error instanceof Error ? error.message : String(error);
				process.stderr.write(`Could not open external URL: ${failure}\n`);
			});
		}

		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event) => event.preventDefault());
};

const loadRenderer = async (window: BrowserWindow): Promise<void> => {
	const developmentUrl = process.env.ELECTRON_RENDERER_URL;

	if (developmentUrl) {
		await window.loadURL(developmentUrl);
		return;
	}

	await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
};

const createMainWindow = async (): Promise<BrowserWindow> => {
	const window = new BrowserWindow({
		...platformWindowOptions(),
		backgroundColor: "#00000000",
		height: MAIN_WINDOW_HEIGHT,
		minHeight: MINIMUM_WINDOW_HEIGHT,
		minWidth: MINIMUM_WINDOW_WIDTH,
		show: false,
		title: "1git",
		transparent: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: join(import.meta.dirname, "../preload/index.js"),
			sandbox: true,
		},
		width: MAIN_WINDOW_WIDTH,
	});

	secureNavigation(window);
	window.once("ready-to-show", () => window.show());
	await loadRenderer(window);

	return window;
};

const start = async (): Promise<void> => {
	nativeTheme.themeSource = "light";
	await app.whenReady();
	await createMainWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow().catch((error: unknown) => {
				const failure = error instanceof Error ? error.message : String(error);
				process.stderr.write(`Could not recreate desktop window: ${failure}\n`);
			});
		}
	});
};

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	repositoryManager.closeAllSessions();
});

start().catch((error: unknown) => {
	const failure =
		error instanceof Error
			? error
			: new Error(`Desktop startup failed: ${error}`);
	process.stderr.write(`${failure.stack ?? failure.message}\n`);
	app.quit();
});

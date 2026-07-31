import { join } from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	dialog,
	ipcMain,
	nativeTheme,
	shell,
	type WebContents,
} from "electron";
import type { RepositoryDirectorySelection } from "../shared/repository-session.js";
import { registerGitIpc } from "./git/git-ipc.js";
import { GitOperationRegistry } from "./git/git-operation-registry.js";
import { JsonRecentRepositoryStore } from "./git/recent-repository-store.js";
import { publishActiveRepositoryFocus } from "./git/repository-events.js";
import { RepositoryManager } from "./git/repository-manager.js";
import { GithubAvatarCache } from "./repository-owners/github-avatar-cache.js";
import { registerRepositoryOwnerIpc } from "./repository-owners/repository-owner-ipc.js";

const MAIN_WINDOW_WIDTH = 1280;
const MAIN_WINDOW_HEIGHT = 820;
const MINIMUM_WINDOW_WIDTH = 980;
const MINIMUM_WINDOW_HEIGHT = 640;
const MACOS_TRAFFIC_LIGHT_X = 16;
const MACOS_TRAFFIC_LIGHT_Y = 17;
const RECENT_REPOSITORIES_FILE = "recent-repositories.json";
const REPOSITORY_OWNER_AVATARS_DIRECTORY = "repository-owner-avatars";
const gitOperationRegistry = new GitOperationRegistry();
let disposeGitIpc: (() => void) | null = null;
let disposeRepositoryOwnerIpc: (() => void) | null = null;
let mainWindow: BrowserWindow | null = null;
let repositoryManager: RepositoryManager | null = null;

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

const pickRepositoryDirectory = async (
	sender: WebContents
): Promise<RepositoryDirectorySelection> => {
	const parentWindow = BrowserWindow.fromWebContents(sender);
	if (!parentWindow || parentWindow.isDestroyed()) {
		return { status: "cancelled" };
	}
	const result = await dialog.showOpenDialog(parentWindow, {
		buttonLabel: "Open Repository",
		properties: ["openDirectory"],
		title: "Open Git Repository",
	});
	const [path] = result.filePaths;
	return result.canceled || !path
		? { status: "cancelled" }
		: { path, status: "selected" };
};

const createMainWindow = async (
	manager: RepositoryManager
): Promise<BrowserWindow> => {
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
	const windowWebContents = window.webContents;
	mainWindow = window;

	secureNavigation(window);
	window.on("focus", () => {
		if (!windowWebContents.isDestroyed()) {
			publishActiveRepositoryFocus(windowWebContents, manager);
		}
	});
	window.once("closed", () => {
		gitOperationRegistry.abortAll(windowWebContents);
		if (mainWindow === window) {
			mainWindow = null;
		}
	});
	window.once("ready-to-show", () => window.show());
	await loadRenderer(window);

	return window;
};

const start = async (): Promise<void> => {
	nativeTheme.themeSource = "light";
	await app.whenReady();
	const manager = new RepositoryManager({
		onPersistenceError: (error) => {
			process.stderr.write(
				`Could not persist recent repositories: ${error.message}\n`
			);
		},
		recentRepositoryStore: new JsonRecentRepositoryStore(
			join(app.getPath("userData"), RECENT_REPOSITORIES_FILE)
		),
	});
	repositoryManager = manager;
	disposeGitIpc = registerGitIpc({
		ipcMain,
		isSenderAuthorized: (event) => event.sender === mainWindow?.webContents,
		operationRegistry: gitOperationRegistry,
		pickRepositoryDirectory,
		repositoryManager: manager,
	});
	disposeRepositoryOwnerIpc = registerRepositoryOwnerIpc({
		avatarProvider: new GithubAvatarCache({
			cacheDirectory: join(
				app.getPath("userData"),
				REPOSITORY_OWNER_AVATARS_DIRECTORY
			),
		}),
		ipcMain,
		isSenderAuthorized: (event) => event.sender === mainWindow?.webContents,
	});
	await createMainWindow(manager);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow(manager).catch((error: unknown) => {
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
	disposeGitIpc?.();
	disposeRepositoryOwnerIpc?.();
	repositoryManager?.closeAllSessions();
});

start().catch((error: unknown) => {
	const failure =
		error instanceof Error
			? error
			: new Error(`Desktop startup failed: ${error}`);
	process.stderr.write(`${failure.stack ?? failure.message}\n`);
	app.quit();
});

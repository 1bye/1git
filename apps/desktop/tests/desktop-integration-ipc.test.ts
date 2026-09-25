import { describe, expect, test } from "bun:test";

import type { IpcMainInvokeEvent } from "electron";

import {
	type DesktopIntegrationOperations,
	registerDesktopIntegrationIpc,
} from "../src/main/desktop-integration/desktop-integration-ipc.js";
import { DESKTOP_INTEGRATION_IPC_CHANNELS } from "../src/shared/desktop-integration.js";

type Handler = (
	event: IpcMainInvokeEvent,
	payload: unknown
) => Promise<unknown>;

const createHarness = (isAuthorized = true) => {
	const handlers = new Map<string, Handler>();
	const removedChannels: string[] = [];
	const requests: string[] = [];

	const operations: DesktopIntegrationOperations = {
		copyText: (text) => requests.push(`copy:${text}`),
		openExternal: (url) => {
			requests.push(`external:${url}`);

			return Promise.resolve();
		},
		openInApplication: (application, path) => {
			requests.push(`${application}:${path}`);

			return Promise.resolve();
		},
		revealPath: (path) => requests.push(`reveal:${path}`),
	};

	const dispose = registerDesktopIntegrationIpc({
		ipcMain: {
			handle: (channel, handler) => {
				handlers.set(channel, handler);
			},
			removeHandler: (channel) => {
				handlers.delete(channel);
				removedChannels.push(channel);
			},
		},
		isSenderAuthorized: () => isAuthorized,
		operations,
	});

	const invoke = async (
		channel: string,
		payload: unknown
	): Promise<unknown> => {
		const handler = handlers.get(channel);

		if (!handler) {
			throw new Error(`Desktop integration handler is unavailable: ${channel}`);
		}

		return await handler({} as IpcMainInvokeEvent, payload);
	};

	return { dispose, invoke, removedChannels, requests };
};

describe("desktop integration IPC", () => {
	test("runs validated desktop operations for an authorized sender", async () => {
		const { invoke, requests } = createHarness();

		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.copyText, {
			text: "repository",
		});
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openExternal, {
			url: "https://github.com/openai/codex",
		});
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openInApplication, {
			application: "ghostty",
			path: "/repositories/codex",
		});
		await invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.revealPath, {
			path: "/repositories/codex",
		});

		expect(requests).toEqual([
			"copy:repository",
			"external:https://github.com/openai/codex",
			"ghostty:/repositories/codex",
			"reveal:/repositories/codex",
		]);
	});

	test("rejects unsafe URLs, paths, and applications", async () => {
		const { invoke, requests } = createHarness();

		await expect(
			invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openExternal, {
				url: "file:///tmp/repository",
			})
		).rejects.toThrow("valid HTTPS URL");
		await expect(
			invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.revealPath, {
				path: "relative/repository",
			})
		).rejects.toThrow("absolute filesystem path");
		await expect(
			invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.openInApplication, {
				application: "unknown",
				path: "/repositories/codex",
			})
		).rejects.toThrow("application is not supported");
		expect(requests).toEqual([]);
	});

	test("rejects unauthorized senders", async () => {
		const { invoke } = createHarness(false);

		await expect(
			invoke(DESKTOP_INTEGRATION_IPC_CHANNELS.copyText, {
				text: "repository",
			})
		).rejects.toThrow("Unauthorized desktop integration IPC sender.");
	});

	test("removes all handlers with an idempotent disposer", () => {
		const { dispose, removedChannels } = createHarness();

		dispose();
		dispose();

		expect(removedChannels).toEqual(
			Object.values(DESKTOP_INTEGRATION_IPC_CHANNELS)
		);
	});
});

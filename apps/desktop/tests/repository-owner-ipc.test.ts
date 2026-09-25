import { describe, expect, test } from "bun:test";

import type { IpcMainInvokeEvent } from "electron";

import { registerRepositoryOwnerIpc } from "../src/main/repository-owners/repository-owner-ipc.js";
import { REPOSITORY_OWNER_IPC_CHANNELS } from "../src/shared/repository-owner-avatar.js";

type Handler = (
	event: IpcMainInvokeEvent,
	payload: unknown
) => Promise<unknown>;

const createHarness = (isAuthorized = true) => {
	const handlers = new Map<string, Handler>();
	const removedChannels: string[] = [];
	const requests: string[] = [];

	const dispose = registerRepositoryOwnerIpc({
		avatarProvider: {
			get: (name) => {
				requests.push(name);

				return Promise.resolve({
					dataUrl: "data:image/png;base64,AQID",
					status: "available" as const,
				});
			},
		},
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
	});

	const invoke = async (payload: unknown): Promise<unknown> => {
		const handler = handlers.get(REPOSITORY_OWNER_IPC_CHANNELS.avatar);

		if (!handler) {
			throw new Error("Repository owner avatar handler is unavailable.");
		}

		return await handler({} as IpcMainInvokeEvent, payload);
	};

	return { dispose, invoke, removedChannels, requests };
};

describe("repository owner IPC", () => {
	test("loads a GitHub owner avatar for an authorized sender", async () => {
		const { invoke, requests } = createHarness();

		expect(
			await invoke({
				host: "GitHub.com",
				name: "OpenAI",
			})
		).toEqual({
			dataUrl: "data:image/png;base64,AQID",
			status: "available",
		});
		expect(requests).toEqual(["OpenAI"]);
	});

	test("does not resolve unsupported or malformed owners", async () => {
		const { invoke, requests } = createHarness();

		expect(await invoke({ host: "gitlab.com", name: "openai" })).toEqual({
			status: "unavailable",
		});
		expect(await invoke({ host: "github.com", name: "" })).toEqual({
			status: "unavailable",
		});
		expect(requests).toEqual([]);
	});

	test("rejects an unauthorized sender", async () => {
		const { invoke } = createHarness(false);

		await expect(
			invoke({ host: "github.com", name: "openai" })
		).rejects.toThrow("Unauthorized repository owner IPC sender.");
	});

	test("removes its handler with an idempotent disposer", () => {
		const { dispose, removedChannels } = createHarness();

		dispose();
		dispose();

		expect(removedChannels).toEqual([REPOSITORY_OWNER_IPC_CHANNELS.avatar]);
	});
});

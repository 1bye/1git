import { describe, expect, test } from "bun:test";
import type { DesktopIpcInvoke } from "../src/preload/git-api.js";
import { createRepositoryOwnerApi } from "../src/preload/repository-owner-api.js";
import { REPOSITORY_OWNER_IPC_CHANNELS } from "../src/shared/repository-owner-avatar.js";

describe("preload repository owner API", () => {
	test("forwards only the explicit avatar request", async () => {
		const invocations: {
			readonly channel: string;
			readonly payload: unknown;
		}[] = [];
		const invoke: DesktopIpcInvoke = (channel, payload) => {
			invocations.push({ channel, payload });
			return Promise.resolve({ status: "unavailable" });
		};
		const api = createRepositoryOwnerApi(invoke);

		await api.avatar({ host: "github.com", name: "openai" });

		expect(invocations).toEqual([
			{
				channel: REPOSITORY_OWNER_IPC_CHANNELS.avatar,
				payload: { host: "github.com", name: "openai" },
			},
		]);
	});
});

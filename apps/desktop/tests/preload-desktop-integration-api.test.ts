import { describe, expect, test } from "bun:test";
import { createDesktopIntegrationApi } from "../src/preload/desktop-integration-api.js";
import type { DesktopIpcInvoke } from "../src/preload/ipc.js";
import { DESKTOP_INTEGRATION_IPC_CHANNELS } from "../src/shared/desktop-integration.js";

describe("preload desktop integration API", () => {
	test("forwards only allow-listed desktop integration requests", async () => {
		const invocations: {
			readonly channel: string;
			readonly payload: unknown;
		}[] = [];
		const invoke: DesktopIpcInvoke = (channel, payload) => {
			invocations.push({ channel, payload });
			return Promise.resolve();
		};
		const api = createDesktopIntegrationApi(invoke);

		await api.copyText("repository");
		await api.openExternal("https://github.com/openai/codex");
		await api.openInApplication("ghostty", "/repositories/codex");
		await api.revealPath("/repositories/codex");

		expect(invocations).toEqual([
			{
				channel: DESKTOP_INTEGRATION_IPC_CHANNELS.copyText,
				payload: { text: "repository" },
			},
			{
				channel: DESKTOP_INTEGRATION_IPC_CHANNELS.openExternal,
				payload: { url: "https://github.com/openai/codex" },
			},
			{
				channel: DESKTOP_INTEGRATION_IPC_CHANNELS.openInApplication,
				payload: {
					application: "ghostty",
					path: "/repositories/codex",
				},
			},
			{
				channel: DESKTOP_INTEGRATION_IPC_CHANNELS.revealPath,
				payload: { path: "/repositories/codex" },
			},
		]);
	});
});

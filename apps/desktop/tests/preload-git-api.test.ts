import { describe, expect, test } from "bun:test";
import { isValidGitOperationId } from "../src/main/git/git-operation-registry.js";
import {
	createDesktopGitApi,
	type DesktopIpcInvoke,
} from "../src/preload/git-api.js";
import { GIT_IPC_CHANNELS } from "../src/shared/git-ipc.js";

interface Invocation {
	readonly channel: string;
	readonly payload: unknown;
}

const createRecordingApi = (): {
	readonly api: ReturnType<typeof createDesktopGitApi>;
	readonly invocations: Invocation[];
} => {
	const invocations: Invocation[] = [];
	const invoke: DesktopIpcInvoke = (channel, payload) => {
		invocations.push({ channel, payload });
		return Promise.resolve({ ok: true, value: null });
	};
	return {
		api: createDesktopGitApi(invoke),
		invocations,
	};
};

describe("preload Git API", () => {
	test("forwards a caller-owned operation ID outside Git input", async () => {
		const { api, invocations } = createRecordingApi();

		await api.repository.snapshot(
			"session-1",
			{ includeIgnored: true },
			{ operationId: "snapshot-from-ui" }
		);

		expect(invocations).toEqual([
			{
				channel: GIT_IPC_CHANNELS.repository.snapshot,
				payload: {
					input: { includeIgnored: true },
					operationId: "snapshot-from-ui",
					sessionId: "session-1",
				},
			},
		]);
	});

	test("forwards operation IDs for repository creation", async () => {
		const { api, invocations } = createRecordingApi();

		await api.sessions.open(
			{ path: "/repository" },
			{ operationId: "open-from-ui" }
		);

		expect(invocations[0]).toEqual({
			channel: GIT_IPC_CHANNELS.sessions.open,
			payload: {
				operationId: "open-from-ui",
				path: "/repository",
			},
		});
	});

	test("generates an internal ID when the caller does not supply one", async () => {
		const { api, invocations } = createRecordingApi();

		await api.sync.fetch("session-1");

		const payload = invocations[0]?.payload;
		if (
			!payload ||
			typeof payload !== "object" ||
			!("operationId" in payload)
		) {
			throw new Error("Expected an operation ID in the preload payload.");
		}
		expect(isValidGitOperationId(String(payload.operationId))).toBe(true);
		expect(invocations[0]).toMatchObject({
			channel: GIT_IPC_CHANNELS.sync.fetch,
			payload: {
				input: {},
				operationId: expect.any(String),
				sessionId: "session-1",
			},
		});
	});

	test("exposes local ID creation and explicit cancellation", async () => {
		const { api, invocations } = createRecordingApi();
		const operationId = api.operations.createId();

		await api.operations.cancel(operationId);

		expect(isValidGitOperationId(operationId)).toBe(true);
		expect(invocations).toEqual([
			{
				channel: GIT_IPC_CHANNELS.operations.cancel,
				payload: { operationId },
			},
		]);
	});

	test("does not attach operation IDs to session bookkeeping calls", async () => {
		const { api, invocations } = createRecordingApi();

		await api.sessions.activate("session-1");
		await api.sessions.close("session-1");

		expect(invocations).toEqual([
			{
				channel: GIT_IPC_CHANNELS.sessions.activate,
				payload: { sessionId: "session-1" },
			},
			{
				channel: GIT_IPC_CHANNELS.sessions.close,
				payload: { sessionId: "session-1" },
			},
		]);
	});
});

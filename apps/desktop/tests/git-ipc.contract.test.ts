import { describe, expect, test } from "bun:test";
import { GIT_IPC_CHANNELS, GIT_IPC_EVENTS } from "../src/shared/git-ipc.js";
import { GitIpcHarness } from "./_shared/git-ipc-harness.js";
import { createTestRepositoryManager } from "./_shared/repository-manager-fixture.js";

const GENERIC_COMMAND_PATTERN = /run-git|raw|execute|command/i;

const allChannels = (): readonly string[] =>
	Object.values(GIT_IPC_CHANNELS).flatMap((group) => Object.values(group));

describe("Git IPC contract", () => {
	test("defines one unique channel for every explicit method", () => {
		const channels = allChannels();

		expect(channels).toHaveLength(69);
		expect(new Set(channels).size).toBe(channels.length);
		expect(channels.every((channel) => channel.startsWith("git:"))).toBe(true);
	});

	test("does not expose a generic command execution channel", () => {
		const channelNames = allChannels().join("\n");

		expect(channelNames).not.toMatch(GENERIC_COMMAND_PATTERN);
		expect(Object.keys(GIT_IPC_CHANNELS)).not.toContain("run");
	});

	test("keeps renderer events separate from invoke handlers", () => {
		const channels = allChannels();
		const events = Object.values(GIT_IPC_EVENTS);

		expect(events).toEqual(["git:event:repository-refresh"]);
		expect(events.every((event) => !channels.includes(event))).toBe(true);
	});

	test("returns native repository picker results through its explicit channel", async () => {
		const harness = new GitIpcHarness(createTestRepositoryManager(), {
			pickRepositoryDirectory: () =>
				Promise.resolve({
					path: "/repositories/selected",
					status: "selected",
				}),
		});

		const selection = await harness.invoke(
			GIT_IPC_CHANNELS.sessions.pickDirectory
		);

		expect(selection).toEqual({
			path: "/repositories/selected",
			status: "selected",
		});
		harness.dispose();
	});

	test("registers every declared channel", () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		expect(new Set(harness.registeredChannels)).toEqual(new Set(allChannels()));

		harness.dispose();
	});

	test("removes every handler with an idempotent disposer", () => {
		const harness = new GitIpcHarness(createTestRepositoryManager());

		harness.dispose();
		harness.dispose();

		expect(harness.registeredChannels).toEqual([]);
	});
});

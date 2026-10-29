/**
 * Covers: failed machine removal and cancellation of remote file reads without blocking cleanup.
 * Real: Machines, RustRuntime and Git execution scopes.
 * Doubles: machine metadata, credential vault and SSH request channel; no real passwords or servers.
 * Requires: none.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { GitExecution, open, realpath, rm } from "@1git/git/runtime";
import { Machines } from "../../src/feature/machines/machines";
import { MachineStore } from "../../src/feature/machines/machine-store";
import {
	RustRuntime,
	type AgentRequest,
} from "../../src/feature/machines/rust-runtime";

afterEach(() => mock.restore());

it("retains a machine and its password when saving its removal fails", async () => {
	const machine = {
		id: crypto.randomUUID(),
		name: "Audit",
		host: "example.invalid",
		username: "",
		port: null,
		identityFile: "",
		folders: [],
	};

	const store = new MachineStore("/unused/machines.json");

	spyOn(store, "load").mockReturnValue([machine]);
	spyOn(store, "save").mockImplementation(() => {
		throw new Error("Disk full");
	});
	const key = MachineStore.credentialKey(machine.id);
	const secrets = new Map([[key, "test-password"]]);

	const vault = {
		read: async (key: string) => secrets.get(key) ?? null,
		write: async (key: string, value: string) => {
			secrets.set(key, value);
		},
		delete: async (key: string) => {
			secrets.delete(key);
		},
	};

	const machines = new Machines(store, vault);

	await expect(machines.remove(machine.id)).rejects.toThrow("Disk full");

	expect(machines.list()).toEqual([machine]);
	expect(secrets.get(key)).toBe("test-password");
});

it("cancels a pending remote filesystem read", async () => {
	const controller = new AbortController();

	const request: AgentRequest = async (_input, signal) =>
		await new Promise((_resolve, reject) => {
			signal?.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});

	const runtime = new RustRuntime(
		"/home/test",
		"/tmp",
		request,
		controller.signal
	);

	const read = GitExecution.run(runtime, () => realpath("/home/test/repo"));

	controller.abort(new Error("Read cancelled"));

	await expect(read).rejects.toThrow("Read cancelled");
});

it("cancels handle reads but still closes handles and removes transaction files afterward", async () => {
	const controller = new AbortController();
	const completed: string[] = [];

	const request: AgentRequest = async (input, signal) => {
		if (input.method === "open") return 1;

		if (input.method === "handle-readFile")
			return await new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});

		signal?.throwIfAborted();
		completed.push(String(input.method));
	};

	const runtime = new RustRuntime(
		"/home/test",
		"/tmp",
		request,
		controller.signal
	);

	const handle = await GitExecution.run(runtime, () => open("/tmp/index", "r"));
	const read = handle.readFile();

	controller.abort(new Error("Read cancelled"));
	await expect(read).rejects.toThrow("Read cancelled");
	await handle.close();
	await GitExecution.run(runtime, () => rm("/tmp/index", { force: true }));

	expect(completed).toEqual(["handle-close", "rm"]);
});

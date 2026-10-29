/**
 * Covers: shared SSH reconnects, failed machine removal and remote file cancellation with cleanup.
 * Real: Machines, RustRuntime and Git execution scopes.
 * Doubles: machine metadata, credential vault and SSH request channel; no real passwords or servers.
 * Requires: none.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { GitExecution, open, realpath, rm } from "@1git/git/runtime";
import { Machines } from "../../src/feature/machines/machines";
import { SshConnection } from "../../src/feature/machines/ssh-connection";
import { MachineStore } from "../../src/feature/machines/machine-store";
import {
	RustRuntime,
	type AgentRequest,
} from "../../src/feature/machines/rust-runtime";

afterEach(() => mock.restore());

it("shares the registered replacement when reconnects overlap old connection disposal", async () => {
	const machine = {
		id: crypto.randomUUID(),
		name: "Test",
		host: "example.invalid",
		username: "",
		port: null,
		identityFile: "",
		folders: [],
	};

	const store = new MachineStore("/unused/machines.json");

	spyOn(store, "load").mockReturnValue([machine]);
	spyOn(SshConnection.prototype, "connect").mockResolvedValue();
	const machines = new Machines(store);
	const old = await machines.connect(machine.id);
	const disposal = Promise.withResolvers<void>();
	const disposed: SshConnection[] = [];

	spyOn(SshConnection.prototype, "dispose").mockImplementation(async function (
		this: SshConnection
	) {
		disposed.push(this);

		if (this === old) await disposal.promise;
	});

	const first = machines.connect(machine.id);
	const second = await machines.connect(machine.id);

	disposal.resolve();
	const replacement = await first;

	expect(replacement).toBe(second);
	expect(replacement).not.toBe(old);
	await machines.disconnect(machine.id);
	expect(disposed).toEqual([old, replacement]);
});

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

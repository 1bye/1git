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
import { MachineLocation } from "../../src/feature/machines/machine-location";
import {
	RustRuntime,
	type AgentRequest,
} from "../../src/feature/machines/rust-runtime";

afterEach(() => mock.restore());

function machineFixture() {
	const machine = {
		id: crypto.randomUUID(),
		name: "Test",
		host: "old.invalid",
		username: "",
		port: null,
		identityFile: "",
		folders: [],
	};

	const store = new MachineStore("/unused/machines.json");

	spyOn(store, "load").mockReturnValue([machine]);
	spyOn(store, "save").mockImplementation(() => {});
	spyOn(SshConnection.prototype, "connect").mockResolvedValue();
	spyOn(SshConnection.prototype, "dispose").mockResolvedValue();

	return {
		machine,
		store,
		location: MachineLocation.encode(machine.id, "/repo"),
	};
}

it("reserves a machine throughout credential changes and reconnects using the saved host", async () => {
	const { machine, store, location } = machineFixture();
	const reading = Promise.withResolvers<void>();
	const release = Promise.withResolvers<string | null>();

	const vault = {
		read: async () => {
			reading.resolve();

			return await release.promise;
		},
		write: async () => {},
		delete: async () => {},
	};

	const machines = new Machines(store, vault);
	const old = await machines.connect(machine.id);

	const request = spyOn(SshConnection.prototype, "request").mockImplementation(
		async function (this: SshConnection) {
			return this.machine.host;
		}
	);

	const save = machines.save(
		{ ...machine, host: "new.invalid" },
		"new-test-password"
	);

	await reading.promise;
	await expect(
		machines.request(location, { operation: "read" })
	).rejects.toThrow("changing");
	expect(request).not.toHaveBeenCalled();
	release.resolve("old-test-password");
	await save;

	expect(machines.list()[0]?.host).toBe("new.invalid");
	expect(await machines.request(location, { operation: "read" })).toBe(
		"new.invalid"
	);
	expect(await machines.connect(machine.id)).not.toBe(old);
	await machines.dispose();
});

it("blocks replacement connections while removing metadata and credentials", async () => {
	const { machine, store, location } = machineFixture();
	const deleting = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();

	const vault = {
		read: async () => "test-password",
		write: async () => {},
		delete: async () => {
			deleting.resolve();
			await release.promise;
		},
	};

	const machines = new Machines(store, vault);

	await machines.connect(machine.id);
	const removal = machines.remove(machine.id);

	await deleting.promise;
	await expect(
		machines.request(location, { operation: "read" })
	).rejects.toThrow("changing");
	await expect(machines.connect(machine.id)).rejects.toThrow("changing");
	release.resolve();
	await removal;

	expect(machines.list()).toEqual([]);
	expect(machines.state(machine.id).status).toBe("Disconnected");
	await expect(machines.connect(machine.id)).rejects.toThrow("no longer saved");
});

it("blocks replacement connections until disconnect disposal finishes", async () => {
	const { machine, store } = machineFixture();
	const machines = new Machines(store);
	const old = await machines.connect(machine.id);
	const disposing = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();

	spyOn(SshConnection.prototype, "dispose").mockImplementation(async () => {
		disposing.resolve();
		await release.promise;
	});
	const disconnect = machines.disconnect(machine.id);

	await disposing.promise;
	await expect(machines.connect(machine.id)).rejects.toThrow("changing");
	release.resolve();
	await disconnect;

	expect(machines.state(machine.id).status).toBe("Disconnected");
	expect(await machines.connect(machine.id)).not.toBe(old);
	await machines.dispose();
});

it("counts requests waiting for SSH readiness but permits metadata-only edits", async () => {
	const { machine, store, location } = machineFixture();
	const ready = Promise.withResolvers<void>();

	spyOn(SshConnection.prototype, "connect").mockImplementation(
		async () => await ready.promise
	);
	spyOn(SshConnection.prototype, "request").mockResolvedValue("read-result");
	const machines = new Machines(store);
	const request = machines.request(location, { operation: "read" });

	await expect(
		machines.save({ ...machine, host: "new.invalid" })
	).rejects.toThrow("remote operations");
	await expect(machines.remove(machine.id)).rejects.toThrow(
		"remote operations"
	);
	await expect(machines.disconnect(machine.id)).rejects.toThrow(
		"remote operations"
	);
	await machines.save({ ...machine, name: "Renamed" });
	ready.resolve();

	expect(await request).toBe("read-result");
	expect(machines.list()[0]?.name).toBe("Renamed");
	await machines.disconnect(machine.id);
});

it("rejects a stale connection that finishes after its machine settings changed", async () => {
	const { machine, store } = machineFixture();
	const ready = Promise.withResolvers<void>();

	const connect = spyOn(SshConnection.prototype, "connect").mockImplementation(
		async () => await ready.promise
	);

	const machines = new Machines(store);
	const connecting = machines.connect(machine.id);

	await machines.save({ ...machine, host: "new.invalid" });
	ready.resolve();
	await expect(connecting).rejects.toThrow("machine changed");
	connect.mockResolvedValue();
	expect((await machines.connect(machine.id)).machine.host).toBe("new.invalid");
	await machines.dispose();
});

it("retains metadata and credentials when connection disposal fails", async () => {
	const { machine, store } = machineFixture();
	const removeSecret = mock(async () => {});

	const machines = new Machines(store, {
		read: async () => "test-password",
		write: async () => {},
		delete: removeSecret,
	});

	await machines.connect(machine.id);
	spyOn(SshConnection.prototype, "dispose").mockRejectedValue(
		new Error("Disposal failed")
	);
	await expect(machines.remove(machine.id)).rejects.toThrow("Disposal failed");
	expect(machines.list()).toEqual([machine]);
	expect(removeSecret).not.toHaveBeenCalled();
	spyOn(SshConnection.prototype, "dispose").mockResolvedValue();
	await machines.remove(machine.id);
	expect(machines.list()).toEqual([]);
});

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

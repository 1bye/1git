/**
 * Covers: secret-free persistence and credential separation.
 * Real: machine models, filesystem persistence and vault coordination.
 * Doubles: OS credential vault.
 * Requires: writable temporary storage.
 */
import { Machines } from "../../src/feature/machines/machines";
import { afterEach, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MachineStore,
	type SavedMachine,
} from "../../src/feature/machines/machine-store";

const directories: string[] = [];

const machine = (): SavedMachine => ({
	id: crypto.randomUUID(),
	name: "Devbox",
	host: "devbox",
	username: "",
	port: null,
	identityFile: "",
	folders: ["/home/me/projects"],
});

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map(
				async (directory) =>
					await rm(directory, { recursive: true, force: true })
			)
	);
});

it("saves only machine metadata and keeps the original file when validation fails", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-machines-"));

	directories.push(directory);
	const store = new MachineStore(join(directory, "machines.json"));
	const saved = machine();

	store.save([{ ...saved, password: "do-not-persist" } as SavedMachine]);
	expect(store.load()).toEqual([saved]);
	expect(await readFile(store.path, "utf8")).not.toContain("do-not-persist");
	expect(() =>
		store.save([{ ...saved, host: "-oProxyCommand=bad" }])
	).toThrow();
	expect(() => store.save([{ ...saved, username: "user;command" }])).toThrow();
	expect(() => store.save([{ ...saved, folders: ["relative"] }])).toThrow();
	expect(store.load()).toEqual([saved]);
});

it("keeps SSH secrets in the vault and restores them if saving metadata fails", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-vault-"));

	directories.push(directory);
	const store = new MachineStore(join(directory, "machines.json"));
	const secrets = new Map<string, string>();

	const service = new Machines(store, {
		async read(key) {
			return secrets.get(key) ?? null;
		},
		async write(key, value) {
			secrets.set(key, value);
		},
		async delete(key) {
			secrets.delete(key);
		},
	});

	const saved = machine();

	await service.save(saved, "first-secret");
	expect(secrets.get(MachineStore.credentialKey(saved.id))).toBe(
		"first-secret"
	);
	expect(await readFile(store.path, "utf8")).not.toContain("first-secret");
	const failure = spyOn(store, "save").mockImplementation(() => {
		throw new Error("Disk unavailable");
	});

	try {
		await expect(
			service.save({ ...saved, name: "Renamed" }, "new-secret")
		).rejects.toThrow("Disk unavailable");
		expect(secrets.get(MachineStore.credentialKey(saved.id))).toBe(
			"first-secret"
		);
		expect(service.list()[0]?.name).toBe("Devbox");
	} finally {
		failure.mockRestore();
	}
});

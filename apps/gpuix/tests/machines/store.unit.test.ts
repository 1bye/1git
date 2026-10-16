/**
 * Covers: machine validation, qualified paths and split protocol frames.
 * Real: machine models and protocol decoding.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	MachineStore,
	type SavedMachine,
} from "../../src/feature/machines/machine-store";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { RemoteFrames } from "../../src/feature/machines/remote-protocol";

const machine = (): SavedMachine => ({
	id: crypto.randomUUID(),
	name: "Devbox",
	host: "devbox",
	username: "",
	port: null,
	identityFile: "",
	folders: [],
});

it("rejects option injection, invalid ports and relative scan roots", () => {
	expect(() =>
		MachineStore.parse([{ ...machine(), host: "-oProxyCommand=bad" }])
	).toThrow();
	expect(() => MachineStore.parse([{ ...machine(), port: 70000 }])).toThrow();
	expect(() =>
		MachineStore.parse([{ ...machine(), folders: ["relative"] }])
	).toThrow();
});

it("qualifies identical remote paths by machine without changing their basename", () => {
	const first = machine();
	const second = machine();

	const location = MachineLocation.encode(
		first.id,
		"/home/me/repo with spaces"
	);

	expect(location).not.toBe(
		MachineLocation.encode(second.id, "/home/me/repo with spaces")
	);
	expect(MachineLocation.parse(location)).toEqual({
		machineId: first.id,
		path: "/home/me/repo with spaces",
	});
	expect(MachineLocation.display(location)).toBe("/home/me/repo with spaces");
	expect(() => MachineLocation.parse(`${location}/../other`)).toThrow();
	expect(MachineLocation.parse("/local/repo")).toBeNull();
});

it("retains split UTF-8 bytes and separates multiple JSON frames", () => {
	const frames = new RemoteFrames();
	const encoded = Buffer.from('{"name":"репозиторій"}\n{"ok":true}\n');
	const decoded: unknown[] = [];

	for (const byte of encoded) decoded.push(...frames.push(Buffer.from([byte])));

	expect(decoded).toEqual([{ name: "репозиторій" }, { ok: true }]);
});

it("restores the selected machine with the repository library across sessions", () => {
	const id = machine().id;

	const session = WorkspaceSession.parse(
		JSON.stringify({
			version: 1,
			tabs: [],
			activeId: null,
			repositoryLibrary: { machine: id, starred: [], view: "listed" },
		})
	);

	expect(session.repositoryLibrary?.machine).toBe(id);
});

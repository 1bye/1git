/**
 * Covers: validating remote directory response paths before exposing them to the picker.
 * Real: machine-qualified path and response validation.
 * Doubles: SSH request; no filesystem, network, credentials or saved-machine storage.
 * Requires: none.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { Machines } from "../../src/feature/machines/machines";
import { MachineStore } from "../../src/feature/machines/machine-store";
import { MachineLocation } from "../../src/feature/machines/machine-location";

afterEach(() => mock.restore());

it("qualifies a valid listing and rejects entries outside the reported directory", async () => {
	const id = "00000000-0000-4000-8000-000000000001";
	const at = (path: string) => MachineLocation.encode(id, path);
	const service = new Machines(new MachineStore("/unused/machines.json"));

	const response = {
		path: "/home/me",
		parent: "/home",
		entries: [{ name: "projects", path: "/home/me/projects" }],
		limited: false,
	};

	const request = spyOn(service, "request").mockResolvedValue(response);
	const signal = new AbortController().signal;

	expect(await service.listDirectory(at("/home/me"), false, signal)).toEqual({
		path: at("/home/me"),
		parent: at("/home"),
		entries: [{ name: "projects", path: at("/home/me/projects") }],
		limited: false,
	});
	expect(request).toHaveBeenCalledWith(
		at("/home/me"),
		{ operation: "list-directory", hidden: false },
		signal
	);
	request.mockResolvedValueOnce({
		...response,
		entries: [{ name: "projects", path: "/elsewhere" }],
	});
	await expect(
		service.listDirectory(at("/home/me"), false, signal)
	).rejects.toThrow("Invalid remote folder entry");
	request.mockResolvedValueOnce({
		...response,
		entries: [{ name: "../escape", path: "/home/escape" }],
	});
	await expect(
		service.listDirectory(at("/home/me"), false, signal)
	).rejects.toThrow("Invalid remote folder entry");
	request.mockResolvedValueOnce({ ...response, path: "relative" });
	await expect(
		service.listDirectory(at("/home/me"), false, signal)
	).rejects.toThrow("Invalid remote folder listing");
});

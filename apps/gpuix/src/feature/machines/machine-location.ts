import { posix } from "node:path";

const prefix = "/@1git-ssh/";
const machineId = /^[a-f0-9-]{36}$/;

/** Absolute, machine-qualified paths preserve existing session and tab identities. Never pass them to local filesystem APIs. */
export class MachineLocation {
	static isRemote(path: string): boolean {
		return path.startsWith(prefix);
	}

	static encode(id: string, path: string): string {
		if (!machineId.test(id) || !posix.isAbsolute(path) || /[\0\r\n]/.test(path))
			throw new Error("Invalid remote repository location.");

		return `${prefix}${id}${posix.normalize(path)}`;
	}

	static parse(location: string): { machineId: string; path: string } | null {
		if (!MachineLocation.isRemote(location)) return null;

		const id = location.slice(prefix.length, prefix.length + 36);
		const path = location.slice(prefix.length + 36);

		if (MachineLocation.encode(id, path) !== location)
			throw new Error("Invalid remote repository location.");

		return { machineId: id, path };
	}

	static display(location: string): string {
		return MachineLocation.parse(location)?.path ?? location;
	}
}

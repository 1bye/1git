import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { WorkspaceSessionStore } from "../workspace-tabs/lib/workspace-session-store";

const maxMetadataBytes = 1024 * 1024;

/** Saved SSH connection and discovery intent. Secrets live only in the OS vault. */
export interface SavedMachine {
	readonly id: string;
	readonly name: string;
	readonly host: string;
	readonly username: string;
	readonly port: number | null;
	readonly identityFile: string;
	readonly folders: readonly string[];
}

/** Validates machine metadata before persistence or process invocation. */
export class MachineStore {
	constructor(
		readonly path = process.env.GPUIX_MACHINES_PATH ??
			join(dirname(WorkspaceSessionStore.defaultPath()), "machines.json")
	) {}

	static parse(value: unknown): SavedMachine[] {
		if (!Array.isArray(value) || value.length > 100)
			throw new Error("Invalid saved machines.");

		const ids = new Set<string>();

		return value.map((item: unknown) => {
			if (!item || typeof item !== "object")
				throw new Error("Invalid saved machine.");

			const { id, name, host, username, port, identityFile, folders } =
				item as Record<string, unknown>;

			const text = (input: unknown): input is string =>
				typeof input === "string" &&
				input.length <= 4096 &&
				!Array.from(input).some(
					(character) =>
						character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
				);

			if (
				!text(id) ||
				!/^[a-f0-9-]{36}$/.test(id) ||
				ids.has(id) ||
				!text(name) ||
				!name.trim() ||
				name.length > 100 ||
				!text(host) ||
				!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(host) ||
				!text(username) ||
				(username !== "" && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(username)) ||
				!(
					port === null ||
					(typeof port === "number" &&
						Number.isInteger(port) &&
						port > 0 &&
						port <= 65535)
				) ||
				!text(identityFile) ||
				(identityFile !== "" && !identityFile.startsWith("/")) ||
				!Array.isArray(folders) ||
				folders.length > 100 ||
				!folders.every((folder) => text(folder) && folder.startsWith("/"))
			)
				throw new Error(
					"Check the machine name, SSH host, username, port, key path and scan folders."
				);

			ids.add(id);

			return {
				id,
				name: name.trim(),
				host,
				username,
				port,
				identityFile,
				folders: [...new Set(folders)],
			};
		});
	}

	static credentialKey(id: string): string {
		return `1git-hosting-v1:${createHash("sha256").update(`ssh-machine:${id}`).digest("hex")}`;
	}

	load(): SavedMachine[] {
		try {
			if (statSync(this.path).size > maxMetadataBytes)
				throw new Error("Machine settings are too large.");

			const content = readFileSync(this.path, "utf8");

			if (Buffer.byteLength(content) > maxMetadataBytes)
				throw new Error("Machine settings are too large.");

			const document: unknown = JSON.parse(content);

			if (
				!document ||
				typeof document !== "object" ||
				!("version" in document) ||
				document.version !== 1 ||
				!("machines" in document)
			)
				throw new Error("Invalid machine settings.");

			return MachineStore.parse(document.machines);
		} catch (cause) {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "ENOENT"
			)
				return [];

			throw new Error(
				"Could not read saved machines. Repair machines.json before saving changes.",
				{ cause }
			);
		}
	}

	save(machines: readonly SavedMachine[]): void {
		const document = { version: 1, machines: MachineStore.parse(machines) };
		const content = `${JSON.stringify(document)}\n`;

		if (Buffer.byteLength(content) > maxMetadataBytes)
			throw new Error("Too many saved machine settings.");

		const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, {
				mode: 0o600,
				flag: "wx",
			});
			renameSync(temporary, this.path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
}

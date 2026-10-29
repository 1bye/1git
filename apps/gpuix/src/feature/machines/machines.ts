import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import type { CredentialVault } from "../accounts/lib/native-credentials";
import { MachineStore, type SavedMachine } from "./machine-store";
import { SshConnection, type MachineStatus } from "./ssh-connection";
import { MachineLocation } from "./machine-location";
import { isRecord } from "./remote-protocol";
import type {
	RepositoryDiscoveryProgress,
	RepositoryDiscoveryScanOptions,
} from "../repository-discovery/repository-discovery";
import type { MachineDirectory } from "./machine-folders";

/** App-owned machine registry. Metadata, credentials and live SSH processes have separate lifetimes. */
export class Machines {
	private static instance?: Machines;

	static get shared(): Machines {
		return (Machines.instance ??= new Machines());
	}
	private saved?: SavedMachine[];
	private loadError?: Error;
	private readonly connections = new Map<string, SshConnection>();
	private readonly states = new Map<
		string,
		{ status: MachineStatus; error?: string }
	>();
	private readonly listeners = new Set<() => void>();
	private version = 0;

	constructor(
		readonly store = new MachineStore(),
		private vault?: CredentialVault
	) {}

	setVault(vault: CredentialVault): void {
		this.vault = vault;
	}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);

		return () => this.listeners.delete(listener);
	};

	readonly snapshot = (): number => this.version;

	private emit(): void {
		this.version++;

		for (const listener of this.listeners) listener();
	}

	list(): readonly SavedMachine[] {
		if (this.loadError) throw this.loadError;

		if (!this.saved) {
			try {
				this.saved = this.store.load();
			} catch (cause) {
				this.loadError =
					cause instanceof Error
						? cause
						: new Error("Could not load machines.");

				throw this.loadError;
			}
		}

		return this.saved;
	}

	state(id: string): { status: MachineStatus; error?: string } {
		return this.states.get(id) ?? { status: "Disconnected" };
	}

	home(id: string): string | undefined {
		return this.connections.get(id)?.home;
	}

	name(id: string): string {
		try {
			return this.list().find((machine) => machine.id === id)?.name ?? "SSH";
		} catch {
			return "SSH";
		}
	}

	async save(machine: SavedMachine, password?: string): Promise<void> {
		MachineStore.parse([machine]);
		const previous = this.list();
		const existing = previous.find((item) => item.id === machine.id);

		const next = MachineStore.parse(
			existing
				? previous.map((item) => (item.id === machine.id ? machine : item))
				: [...previous, machine]
		);

		if (
			existing &&
			(password ||
				existing.host !== machine.host ||
				existing.username !== machine.username ||
				existing.port !== machine.port ||
				existing.identityFile !== machine.identityFile)
		)
			await this.disconnect(machine.id);

		const vault = this.vault;
		const key = MachineStore.credentialKey(machine.id);
		const oldSecret = password && vault ? await vault.read(key) : null;

		if (password) {
			if (!vault) throw new Error("Secure credential storage is unavailable.");

			await vault.write(key, password);
		}

		try {
			this.store.save(next);
		} catch (cause) {
			if (password && vault) {
				if (oldSecret === null) await vault.delete(key);
				else await vault.write(key, oldSecret);
			}

			throw cause;
		}

		this.saved = next;
		this.emit();
	}

	async remove(id: string): Promise<void> {
		const next = this.list().filter((machine) => machine.id !== id);

		if (this.connections.get(id)?.busy)
			throw new Error(
				"Wait for remote operations to finish before removing this machine."
			);

		const vault = this.vault;
		const key = MachineStore.credentialKey(id);
		const oldSecret = vault ? await vault.read(key) : null;

		await vault?.delete(key);

		try {
			this.store.save(next);
		} catch (cause) {
			if (oldSecret !== null && vault) await vault.write(key, oldSecret);

			throw cause;
		}

		this.saved = next;
		await this.disconnect(id);
		this.emit();
	}

	async disconnect(id: string): Promise<void> {
		const connection = this.connections.get(id);

		if (connection?.busy)
			throw new Error(
				"Wait for remote operations to finish before disconnecting."
			);

		this.connections.delete(id);
		await connection?.dispose();
		this.states.set(id, { status: "Disconnected" });
		this.emit();
	}

	async connect(id: string): Promise<SshConnection> {
		let current = this.connections.get(id);

		if (current && this.state(id).status === "Disconnected") {
			this.connections.delete(id);
			await current.dispose();
			current = undefined;
		}

		if (current) {
			await current.connect();

			return current;
		}

		const machine = this.list().find((item) => item.id === id);

		if (!machine)
			throw new Error(
				"This SSH machine is no longer saved. Add it again from Home."
			);

		const connection = new SshConnection(
			machine,
			async () =>
				(await this.vault?.read(MachineStore.credentialKey(id))) ?? null,
			(status, error) => {
				if (this.connections.get(id) !== connection) return;

				this.states.set(id, { status, error });
				this.emit();
			}
		);

		this.connections.set(id, connection);
		await connection.connect();

		return connection;
	}

	async request(
		location: string,
		input: Record<string, unknown>,
		signal?: AbortSignal,
		progress?: (value: unknown) => void
	): Promise<unknown> {
		signal?.throwIfAborted();
		const remote = MachineLocation.parse(location);

		if (!remote) throw new Error("Choose a remote repository.");

		const connection = await this.connect(remote.machineId);

		return await connection.request(
			{ ...input, path: remote.path },
			signal,
			progress
		);
	}

	/** Lists only immediate child folders; paths stay bound to this saved machine. */
	async listDirectory(
		location: string,
		hidden: boolean,
		signal: AbortSignal
	): Promise<MachineDirectory> {
		const remote = MachineLocation.parse(location);

		if (!remote) throw new Error("Choose an SSH machine.");

		const value = await this.request(
			location,
			{ operation: "list-directory", hidden },
			signal
		);

		if (
			!isRecord(value) ||
			typeof value.path !== "string" ||
			!posix.isAbsolute(value.path) ||
			typeof value.parent !== "string" ||
			value.parent !== posix.dirname(value.path) ||
			typeof value.limited !== "boolean" ||
			!Array.isArray(value.entries) ||
			value.entries.length > 500
		)
			throw new Error("Invalid remote folder listing.");

		const path = value.path;

		const qualify = (path: string) =>
			MachineLocation.encode(remote.machineId, path);

		const entries = value.entries.map((entry) => {
			if (
				!isRecord(entry) ||
				typeof entry.name !== "string" ||
				!entry.name ||
				entry.name === "." ||
				entry.name === ".." ||
				posix.basename(entry.name) !== entry.name ||
				entry.path !== posix.join(path, entry.name)
			)
				throw new Error("Invalid remote folder entry.");

			return { name: entry.name, path: qualify(posix.join(path, entry.name)) };
		});

		return {
			path: qualify(path),
			parent: qualify(value.parent),
			entries,
			limited: value.limited,
		};
	}

	async isSymlink(
		location: string,
		file: string,
		signal: AbortSignal
	): Promise<boolean> {
		const result = await this.request(
			location,
			{ operation: "symlink", file },
			signal
		);

		if (typeof result !== "boolean")
			throw new Error("Invalid remote file metadata.");

		return result;
	}

	async scan(
		id: string,
		folders: readonly string[],
		signal: AbortSignal,
		report: (progress: RepositoryDiscoveryProgress) => void,
		options?: RepositoryDiscoveryScanOptions
	): Promise<RepositoryDiscoveryProgress> {
		const connection = await this.connect(id);

		const roots = folders.map((folder) => {
			const location = MachineLocation.parse(folder);

			if (location?.machineId !== id)
				throw new Error("Choose a scan folder on this machine.");

			return location.path;
		});

		const parse = (value: unknown): RepositoryDiscoveryProgress => {
			if (
				!isRecord(value) ||
				!Array.isArray(value.paths) ||
				!value.paths.every(
					(path) => typeof path === "string" && path.startsWith("/")
				) ||
				typeof value.scanned !== "number" ||
				typeof value.skipped !== "number" ||
				typeof value.limited !== "boolean"
			)
				throw new Error("Invalid remote discovery response.");

			return {
				paths: value.paths.map((path) => MachineLocation.encode(id, path)),
				scanned: value.scanned,
				skipped: value.skipped,
				limited: value.limited,
			};
		};

		return parse(
			await connection.request(
				{
					operation: "scan",
					folders: roots,
					...(options?.shallow
						? {
								shallow: true,
								query: options.query,
								knownPaths: (options.knownPaths ?? []).flatMap((path) => {
									const location = MachineLocation.parse(path);

									return location?.machineId === id ? [location.path] : [];
								}),
							}
						: {}),
				},
				signal,
				(value) => report(parse(value))
			)
		);
	}

	/** Literal SSH aliases are suggestions only; OpenSSH resolves Include, Match and host settings at connection time. */
	static async aliases(): Promise<string[]> {
		try {
			const content = await readFile(join(homedir(), ".ssh/config"), "utf8");

			return [
				...new Set(
					[...content.matchAll(/^\s*Host\s+([^#\r\n]+)/gim)]
						.flatMap((match) => (match[1] ?? "").trim().split(/\s+/))
						.filter((host) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(host))
				),
			];
		} catch (cause) {
			if (
				cause &&
				typeof cause === "object" &&
				"code" in cause &&
				cause.code === "ENOENT"
			)
				return [];

			throw new Error(
				"Could not read SSH hosts. You can enter the host directly."
			);
		}
	}

	async dispose(): Promise<void> {
		const connections = [...this.connections.values()];

		this.connections.clear();

		for (const id of this.states.keys())
			this.states.set(id, { status: "Disconnected" });

		this.emit();
		await Promise.allSettled(
			connections.map(async (connection) => await connection.dispose())
		);
	}
}

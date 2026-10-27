import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rm,
	stat,
	type FileHandle,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import {
	encodeLauncherRequest,
	launcherMaxPathBytes,
	parseLauncherRequest,
	type LauncherRequest,
} from "./launcher-protocol";

const launcherDirectory = "1git-gpuix";
const socketName = "launcher.sock";
const response = '{"ok":true}\n';
const requestTimeoutMs = 2_000;
const socketProbeTimeoutMs = 400;
const startupLockTimeoutMs = 5_000;
const startupLockRetryMs = 10;

export const defaultLauncherSocketPath = (): string => {
	if (process.env.GPUIX_LAUNCHER_SOCKET)
		return process.env.GPUIX_LAUNCHER_SOCKET;

	if (process.platform === "darwin")
		return join(
			homedir(),
			"Library",
			"Application Support",
			launcherDirectory,
			socketName
		);

	return join(
		process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".local", "state"),
		launcherDirectory,
		socketName
	);
};

const closeQuietly = (socket: Socket): void => {
	socket.removeAllListeners();
	socket.destroy();
};

const inspectSocket = async (
	path: string
): Promise<"missing" | "active" | "stale"> => {
	try {
		const info = await lstat(path);

		if (!info.isSocket())
			throw new Error("The launcher socket path is not a socket.");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return "missing";

		throw error;
	}

	return await new Promise((resolve) => {
		const socket = createConnection({ path });

		const finish = (state: "active" | "stale") => {
			closeQuietly(socket);
			resolve(state);
		};

		socket.setTimeout(socketProbeTimeoutMs, () => finish("stale"));
		socket.once("connect", () => finish("active"));
		socket.once("error", (error: NodeJS.ErrnoException) => {
			finish(
				error.code === "ECONNREFUSED" || error.code === "ENOENT"
					? "stale"
					: "active"
			);
		});
	});
};

export type LauncherRequestHandler = (request: LauncherRequest) => void;

/** Owns the per-user Unix socket and keeps the transport independent from App state. */
export class LauncherService {
	private server?: Server;
	private ownsSocket = false;
	private startPromise?: Promise<boolean>;

	constructor(
		readonly socketPath = defaultLauncherSocketPath(),
		private onRequest?: LauncherRequestHandler
	) {}

	setRequestHandler(handler?: LauncherRequestHandler): void {
		this.onRequest = handler;
	}

	async start(): Promise<boolean> {
		if (this.server) return true;

		if (this.startPromise) return await this.startPromise;

		const startPromise = this.startInternal();

		this.startPromise = startPromise;

		try {
			return await startPromise;
		} finally {
			if (this.startPromise === startPromise) this.startPromise = undefined;
		}
	}

	private async startInternal(): Promise<boolean> {
		if (this.server) return true;

		const directory = dirname(this.socketPath);

		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);

		return await withStartupLock(this.socketPath, async () => {
			const state = await inspectSocket(this.socketPath);

			if (state === "active") return false;

			if (state === "stale") await rm(this.socketPath, { force: true });

			return await this.bind();
		});
	}

	private async bind(): Promise<boolean> {
		const server = createServer((socket) => this.handleConnection(socket));

		this.server = server;

		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(this.socketPath, () => resolve());
			});
			await chmod(this.socketPath, 0o600);
			this.ownsSocket = true;

			return true;
		} catch (error) {
			this.server = undefined;
			server.close();

			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "EADDRINUSE"
			)
				return false;

			throw error;
		}
	}

	async stop(): Promise<void> {
		const server = this.server;

		this.server = undefined;

		if (server)
			await new Promise<void>((resolve) => server.close(() => resolve()));

		if (this.ownsSocket) {
			this.ownsSocket = false;
			await rm(this.socketPath, { force: true });
		}
	}

	private handleConnection(socket: Socket): void {
		let buffer = "";
		let handled = false;

		socket.on("error", () => closeQuietly(socket));
		socket.setTimeout(requestTimeoutMs, () => closeQuietly(socket));

		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			if (handled) return;

			buffer += chunk;

			if (Buffer.byteLength(buffer, "utf8") > launcherMaxPathBytes + 128) {
				closeQuietly(socket);

				return;
			}

			const newline = buffer.indexOf("\n");

			if (newline < 0) return;

			const message = buffer.slice(0, newline);

			handled = true;

			try {
				const request = parseLauncherRequest(message);

				this.onRequest?.(request);
				socket.end(response);
			} catch {
				closeQuietly(socket);
			}
		});
	}
}

export const sendLauncherRequest = async (
	request: LauncherRequest,
	socketPath = defaultLauncherSocketPath(),
	timeoutMs = 400
): Promise<boolean> =>
	await new Promise((resolve) => {
		const socket = createConnection({ path: socketPath });
		let settled = false;
		let buffer = "";
		let timer: ReturnType<typeof setTimeout>;

		const finish = (result: boolean) => {
			if (settled) return;

			settled = true;
			clearTimeout(timer);
			closeQuietly(socket);
			resolve(result);
		};

		timer = setTimeout(() => finish(false), timeoutMs);

		socket.once("connect", () => socket.write(encodeLauncherRequest(request)));
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();

			if (Buffer.byteLength(buffer, "utf8") > response.length + 32) {
				finish(false);

				return;
			}

			const newline = buffer.indexOf("\n");

			if (newline < 0) return;

			finish(buffer.slice(0, newline).trim() === response.trim());
		});
		socket.once("error", () => finish(false));
	});

/** Queues requests until App subscribes after its native tree has rendered. */
export class LauncherRequestQueue {
	private pending: LauncherRequest[] = [];
	private readonly listeners = new Set<LauncherRequestHandler>();

	enqueue(request: LauncherRequest): void {
		if (this.listeners.size === 0) {
			this.pending.push(request);

			return;
		}

		for (const listener of this.listeners) listener(request);
	}

	subscribe(listener: LauncherRequestHandler): () => void {
		this.listeners.add(listener);

		for (const request of this.pending) listener(request);

		this.pending = [];

		return () => this.listeners.delete(listener);
	}
}

const withStartupLock = async <Result>(
	socketPath: string,
	callback: () => Promise<Result>
): Promise<Result> => {
	const lockPath = `${socketPath}.lock`;
	const deadline = Date.now() + startupLockTimeoutMs;
	let lock: FileHandle | undefined;
	let lockIdentity: { dev: number; ino: number } | undefined;

	while (!lock) {
		try {
			const candidate = await open(lockPath, "wx", 0o600);
			let candidateIdentity: { dev: number; ino: number } | undefined;

			try {
				const identity = await candidate.stat();

				candidateIdentity = { dev: identity.dev, ino: identity.ino };
				await candidate.writeFile(`${process.pid}\n`);

				lock = candidate;
				lockIdentity = candidateIdentity;
			} catch (error) {
				await candidate.close();

				if (candidateIdentity)
					await removeLockIfUnchanged(lockPath, candidateIdentity);

				throw error;
			}
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;

			try {
				const lockInfo = await stat(lockPath);
				let ownerPid: number | undefined;

				try {
					const value = (await readFile(lockPath, "utf8")).trim();
					const parsed = Number(value);

					if (Number.isSafeInteger(parsed) && parsed > 0) ownerPid = parsed;
				} catch {
					// A lock being written is still owned; wait for its writer.
				}

				const ownerAlive = ownerPid !== undefined && isProcessAlive(ownerPid);
				const expired = Date.now() - lockInfo.mtimeMs > startupLockTimeoutMs;

				if (ownerPid !== undefined && !ownerAlive)
					await removeLockIfUnchanged(lockPath, lockInfo);
				else if (ownerPid === undefined && expired)
					await removeLockIfUnchanged(lockPath, lockInfo);
				else if (Date.now() < deadline)
					await new Promise((resolve) =>
						setTimeout(resolve, startupLockRetryMs)
					);
				else
					throw new Error(
						"Another 1git process is claiming the launcher socket."
					);
			} catch (lockError) {
				if (
					lockError instanceof Error &&
					"code" in lockError &&
					lockError.code === "ENOENT"
				)
					continue;

				throw lockError;
			}
		}
	}

	try {
		return await callback();
	} finally {
		await lock.close();

		if (lockIdentity) await removeLockIfUnchanged(lockPath, lockIdentity);
	}
};

const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
};

const removeLockIfUnchanged = async (
	lockPath: string,
	identity: { dev: number; ino: number }
): Promise<void> => {
	try {
		const current = await stat(lockPath);

		if (current.dev === identity.dev && current.ino === identity.ino)
			await rm(lockPath, { force: true });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
};

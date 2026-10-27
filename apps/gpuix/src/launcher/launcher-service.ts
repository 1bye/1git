import { chmod, lstat, mkdir, rm } from "node:fs/promises";
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

	constructor(
		readonly socketPath = defaultLauncherSocketPath(),
		private readonly onRequest?: LauncherRequestHandler
	) {}

	async start(): Promise<boolean> {
		if (this.server) return true;

		const state = await inspectSocket(this.socketPath);

		if (state === "active") return false;

		if (state === "stale") await rm(this.socketPath, { force: true });

		await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
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
		socket.once("data", (chunk: Buffer | string) => {
			const message = chunk.toString().trim();

			finish(message === response.trim());
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

export const launcherRequests = new LauncherRequestQueue();

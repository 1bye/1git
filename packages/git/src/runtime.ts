import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import * as localFiles from "node:fs/promises";
import { homedir as localHome, tmpdir as localTemporary } from "node:os";
import type {
	GitCommandInput,
	GitCommandOutput,
} from "./process/git-process.js";

/** Execution boundary for Git and its filesystem; a scope never falls back to local I/O. */
export interface GitExecutionRuntime {
	readonly home: string;
	readonly temporary: string;
	files(method: string, args: unknown[]): Promise<unknown>;
	git(
		input: GitCommandInput,
		maxOutputBytes: number
	): Promise<GitCommandOutput>;
}

const scope = new AsyncLocalStorage<GitExecutionRuntime>();

/** Keeps remote execution isolated across concurrent machines and local repository operations. */
export class GitExecution {
	static get current(): GitExecutionRuntime | undefined {
		return scope.getStore();
	}
	static run<T>(runtime: GitExecutionRuntime, task: () => T): T {
		return scope.run(runtime, task);
	}
}

// Preserve Node's overloads while dispatching each call inside its async execution scope.
const files = new Proxy(localFiles, {
	get(target, key) {
		const local = Reflect.get(target, key);

		if (typeof local !== "function") return local;

		return (...args: unknown[]) => {
			const runtime = GitExecution.current;

			return runtime
				? runtime.files(String(key), args)
				: Reflect.apply(local, target, args);
		};
	},
});

export const {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	open,
	opendir,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} = files;
export const homedir = (): string => GitExecution.current?.home ?? localHome();
export const tmpdir = (): string =>
	GitExecution.current?.temporary ?? localTemporary();

/** Installs prepared repository entries relative to a checked directory descriptor, never through a symlink. */
export async function installDirectory(
	source: string,
	destination: string,
	identity: { dev: number; ino: number }
): Promise<void> {
	const runtime = GitExecution.current;

	if (runtime) {
		await runtime.files("installDirectory", [source, destination, identity]);

		return;
	}

	const { DirectoryInstall } = await import("./directory-install.js");

	await DirectoryInstall.run(source, destination, identity);
}

/** Async existence check usable on both local and remote Git metadata. */
export const exists = async (path: string): Promise<boolean> => {
	if (!GitExecution.current) return existsSync(path);

	try {
		await stat(path);

		return true;
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			["ENOENT", "ENOTDIR"].includes(String(error.code))
		)
			return false;

		throw error;
	}
};

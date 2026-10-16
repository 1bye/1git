import { opendir, realpath } from "node:fs/promises";
import { posix } from "node:path";
import { MachineLocation } from "./machine-location";

/** One bounded directory listing; the wire uses raw paths, while the app qualifies them with machine identity. */
export interface MachineDirectory {
	readonly path: string;
	readonly parent: string;
	readonly entries: readonly { readonly name: string; readonly path: string }[];
	readonly limited: boolean;
}

/** Read-only filesystem listing used by the headless helper. Never follows child symlinks or scans descendants. */
export class LocalMachineFolders {
	static async read(
		path: string,
		hidden: boolean,
		signal: AbortSignal
	): Promise<MachineDirectory> {
		if (
			!posix.isAbsolute(path) ||
			MachineLocation.isRemote(path) ||
			/[\0\r\n]/.test(path)
		)
			throw new Error("Enter an absolute folder path on this machine.");

		signal.throwIfAborted();
		const canonical = await realpath(path);
		const entries: { name: string; path: string }[] = [];
		let visited = 0;
		let limited = false;

		for await (const entry of await opendir(canonical)) {
			signal.throwIfAborted();
			visited++;

			if (visited > 10000 || entries.length >= 500) {
				limited = true;
				break;
			}

			if (
				!entry.isDirectory() ||
				/[\0\r\n]/.test(entry.name) ||
				(!hidden && entry.name.startsWith("."))
			)
				continue;

			entries.push({
				name: entry.name,
				path: posix.join(canonical, entry.name),
			});
		}

		entries.sort((a, b) =>
			a.name.localeCompare(b.name, undefined, {
				numeric: true,
				sensitivity: "base",
			})
		);

		return {
			path: canonical,
			parent: posix.dirname(canonical),
			entries,
			limited,
		};
	}
}

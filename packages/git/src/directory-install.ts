import { dlopen, ptr } from "bun:ffi";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Installs prepared entries without following a replaced destination or overwriting existing files. */
export class DirectoryInstall {
	static async run(
		source: string,
		destination: string,
		identity: { dev: number; ino: number }
	): Promise<void> {
		if (process.platform !== "darwin" && process.platform !== "linux")
			throw new Error("Safe repository setup requires macOS or Linux.");

		const directory = await open(
			destination,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
		);

		try {
			const current = await directory.stat();

			if (current.dev !== identity.dev || current.ino !== identity.ino)
				throw new Error("The destination folder changed during setup.");

			const entries = await readdir(source);
			const mac = process.platform === "darwin";
			const rename = mac ? "renameatx_np" : "renameat2";
			const currentDirectoryFd = mac ? -2 : -100;
			const exclusiveRename = mac ? 4 : 1;

			const library = dlopen(mac ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
				[rename]: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
			});

			try {
				for (const entry of entries) {
					const from = Buffer.from(`${join(source, entry)}\0`);
					const to = Buffer.from(`${entry}\0`);

					// RENAME_EXCL on macOS and RENAME_NOREPLACE on Linux never replace a concurrent entry.
					if (
						library.symbols[rename]!(
							currentDirectoryFd,
							ptr(from),
							directory.fd,
							ptr(to),
							exclusiveRename
						) !== 0
					) {
						throw new Error(
							"Could not install repository files without replacing existing entries."
						);
					}
				}
			} finally {
				library.close();
			}
		} finally {
			await directory.close();
		}
	}
}

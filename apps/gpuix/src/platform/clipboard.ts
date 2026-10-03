/** Shared macOS text clipboard boundary. Values travel through stdin, never shell commands. */
export class NativeClipboard {
	static async write(value: string): Promise<void> {
		if (process.platform !== "darwin")
			throw new Error("Clipboard copying is currently supported on macOS.");

		const child = Bun.spawn(["/usr/bin/pbcopy"], {
			stdin: new TextEncoder().encode(value),
			stdout: "ignore",
			stderr: "ignore",
		});

		if ((await child.exited) !== 0)
			throw new Error("Could not copy to the clipboard.");
	}
}

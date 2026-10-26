/** Shared text clipboard boundary. Values travel through stdin, never shell commands. */
export class NativeClipboard {
	static async write(value: string): Promise<void> {
		// Wayland first, then X11. Each candidate is tried in order; a missing
		// binary exits non-zero and falls through to the next one.
		const commands =
			process.platform === "darwin"
				? [["/usr/bin/pbcopy"]]
				: process.platform === "linux"
					? [
							["wl-copy"],
							["xclip", "-selection", "clipboard"],
							["xsel", "--clipboard", "--input"],
						]
					: [];

		if (!commands.length)
			throw new Error("Clipboard copying is not supported on this platform.");

		for (const command of commands) {
			try {
				const child = Bun.spawn(command, {
					stdin: new TextEncoder().encode(value),
					stdout: "ignore",
					stderr: "ignore",
				});

				if ((await child.exited) === 0) return;
			} catch {
				// Bun.spawn throws when the binary is missing; try the next one.
				continue;
			}
		}

		throw new Error(
			"Could not copy to the clipboard. On Linux, install wl-clipboard (Wayland) or xclip (X11)."
		);
	}
}

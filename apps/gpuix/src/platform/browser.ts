/** Shared HTTPS browser boundary; URLs are validated and passed as arguments, never shell commands. */
export class NativeBrowser {
	static async open(value: string): Promise<void> {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			throw new Error("Invalid browser URL.");
		}

		if (url.protocol !== "https:" || url.username || url.password || url.hash)
			throw new Error("Invalid browser URL.");

		const command =
			process.platform === "darwin"
				? ["/usr/bin/open", url.href]
				: process.platform === "linux"
					? ["xdg-open", url.href]
					: null;

		if (!command)
			throw new Error("Opening the browser is not supported on this platform.");

		try {
			const child = Bun.spawn(command, {
				stdout: "ignore",
				stderr: "ignore",
			});

			if ((await child.exited) !== 0)
				throw new Error("Could not open the browser. Try again.");
		} catch {
			throw new Error("Could not open the browser. Try again.");
		}
	}
}

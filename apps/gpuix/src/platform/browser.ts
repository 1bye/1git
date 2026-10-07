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

		if (process.platform !== "darwin")
			throw new Error("Opening the browser is currently supported on macOS.");

		const child = Bun.spawn(["/usr/bin/open", url.href], {
			stdout: "ignore",
			stderr: "ignore",
		});

		if ((await child.exited) !== 0)
			throw new Error("Could not open the browser. Try again.");
	}
}

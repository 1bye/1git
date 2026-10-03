/**
 * Covers: UTF-8 clipboard input, failed writes and shared file-copy delegation.
 * Real: clipboard adapter, file action routing and Bun subprocess exit status.
 * Doubles: pbcopy invocation returns a harmless true/false process; system clipboard stays untouched.
 * Requires: macOS and /usr/bin/true and /usr/bin/false.
 */
import { expect, it, spyOn } from "bun:test";
import { NativeClipboard } from "../../src/platform/clipboard";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";

it("passes public text and file paths as exact UTF-8 stdin without shell interpretation", async () => {
	const child = Bun.spawn(["/usr/bin/true"]);

	await child.exited;

	const spawn = spyOn(Bun, "spawn").mockReturnValue(child);
	const value = "http://127.0.0.1:8765/oauth/callback\nΩ $(literal)";

	try {
		await NativeClipboard.write(value);
		await RepositoryFileActions.open(
			"/unused",
			"folder/a.txt\nfolder/b.txt",
			"copy"
		);

		expect(spawn).toHaveBeenCalledWith(["/usr/bin/pbcopy"], {
			stdin: new TextEncoder().encode(value),
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(spawn.mock.calls[1]?.[1]?.stdin).toEqual(
			new TextEncoder().encode("folder/a.txt\nfolder/b.txt")
		);
	} finally {
		spawn.mockRestore();
	}
});

it("reports an unsuccessful clipboard process as a safe retryable error", async () => {
	const child = Bun.spawn(["/usr/bin/false"]);

	await child.exited;

	const spawn = spyOn(Bun, "spawn").mockReturnValue(child);

	try {
		await expect(NativeClipboard.write("1git")).rejects.toThrow(
			"Could not copy to the clipboard."
		);
	} finally {
		spawn.mockRestore();
	}
});

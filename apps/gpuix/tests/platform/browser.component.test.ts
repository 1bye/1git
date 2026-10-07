/**
 * Covers: HTTPS-only browser launch arguments and process failure reporting.
 * Real: URL validation and the shared native browser boundary.
 * Doubles: browser launch replaced by a harmless child process; no browser or network.
 * Requires: macOS command-line utilities.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { NativeBrowser } from "../../src/platform/browser";

afterEach(() => mock.restore());

it("opens a validated commit or authorization URL without shell interpolation", async () => {
	const child = Bun.spawn(["/usr/bin/true"], {
		stdout: "ignore",
		stderr: "ignore",
	});

	const launch = spyOn(Bun, "spawn").mockReturnValue(child);

	for (const url of [
		`https://github.com/team/project/commit/${"a".repeat(40)}`,
		"https://gitlab.example.invalid/oauth/authorize?state=public-state&scope=read_user",
	]) {
		await NativeBrowser.open(url);
		expect(launch).toHaveBeenLastCalledWith(["/usr/bin/open", url], {
			stdout: "ignore",
			stderr: "ignore",
		});
	}
});

it("rejects unsafe URLs before launching and reports browser process failure", async () => {
	const child = Bun.spawn(["/usr/bin/false"], {
		stdout: "ignore",
		stderr: "ignore",
	});

	const launch = spyOn(Bun, "spawn").mockReturnValue(child);

	for (const url of [
		"malformed private URL",
		"file:///private/tmp/project",
		"javascript:alert(1)",
		"http://github.com/team/project",
		"https://user:secret@github.com/team/project",
		"https://github.com/team/project#fragment",
	])
		await expect(NativeBrowser.open(url)).rejects.toThrow(
			"Invalid browser URL."
		);

	expect(launch).not.toHaveBeenCalled();
	await expect(
		NativeBrowser.open("https://github.com/team/project")
	).rejects.toThrow("Could not open the browser. Try again.");
});

/**
 * Covers: repeated native renderer replacement, idempotent disposal, and host exit.
 * Real: pinned GPUI/AppKit addon and macOS heap allocation inspection.
 * Doubles: empty rendered tree; no Git repositories or user session data.
 * Requires: Apple Silicon macOS graphics/debugging access and built native addon.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const appDirectory = resolve(import.meta.dir, "../..");

const command = [
	process.execPath,
	"--preload",
	"./native/preload.ts",
	"tests/_shared/test-session-native.ts",
];

it("releases old native views without JS garbage collection or event pumping", async () => {
	const child = Bun.spawn([...command, "inspect"], {
		cwd: appDirectory,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const errors = new Response(child.stderr).text();

	try {
		const reader = child.stdout.getReader();
		let output = "";

		while (!output.includes("Session disposed")) {
			const chunk = await reader.read();

			if (chunk.done) throw new Error(`Native probe exited: ${await errors}`);

			output += new TextDecoder().decode(chunk.value);
		}

		reader.releaseLock();
		const heap = execFileSync(
			"/usr/bin/heap",
			["-s", "--noContent", String(child.pid)],
			{
				encoding: "utf8",
				timeout: 15000,
			}
		);

		expect(heap).toContain("nodes malloced");
		// Count actual native objects rather than an allocator-dependent RSS threshold.
		const retainedWindowOrView = heap
			.split("\n")
			.find((line) =>
				/\b(?:NSKVONotifying_)?GPUI(?:View|Window)\s+ObjC\b/u.test(line)
			);

		expect(retainedWindowOrView).toBeUndefined();
		child.stdin.end();
		expect(await child.exited).toBe(0);
		expect(await errors).not.toContain("panicked");
	} finally {
		if (child.exitCode === null) child.kill();

		await child.exited;
	}
}, 30000);

it("disposes the remaining test session before native host shutdown", () => {
	expect(() =>
		execFileSync(process.execPath, command.slice(1), {
			cwd: appDirectory,
			timeout: 15000,
			stdio: "pipe",
		})
	).not.toThrow();
}, 20000);

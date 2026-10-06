import { deepStrictEqual, throws } from "node:assert";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestGpuixRenderer } from "@gpuix/native";
import { editorApplication } from "./editor-application";

const renderer = new TestGpuixRenderer(800, 600);
const inspect: unknown = Reflect.get(renderer, "contextMenuIconSizes");
const dispose: unknown = Reflect.get(TestGpuixRenderer, "disposeCurrent");

if (typeof inspect !== "function" || typeof dispose !== "function")
	throw new Error("Rebuild native menu icon support before running this test.");

const imageSizes = (paths: string[]): unknown => inspect.call(renderer, paths);

let directory: string | undefined;
const mode = process.argv[2];

try {
	if (mode === "icons") {
		directory = await realpath(
			await mkdtemp(join(tmpdir(), "1git-menu-icons-"))
		);
		const custom = await editorApplication(directory, "Custom Editor.app");

		deepStrictEqual(
			imageSizes(["/System/Library/CoreServices/Finder.app", custom]),
			[16, 16, 16, 16]
		);
		await rm(custom, { recursive: true });
		// A cached copy remains usable without rereading the removed bundle.
		deepStrictEqual(imageSizes([custom]), [16, 16]);
	} else if (mode === "fallback") {
		const invalid = [
			"",
			"relative.app",
			"/usr/bin/open",
			"https://example.invalid/Editor.app",
			"/Applications/../Finder.app",
			"/Applications/Invalid\0.app",
			"/Applications/Invalid\n.app",
			`/Applications/${"x".repeat(4100)}.app`,
			"/Applications/1git Missing Menu Icon.app",
		];

		deepStrictEqual(
			imageSizes(invalid),
			invalid.flatMap(() => [0, 0])
		);
		throws(
			() => imageSizes(Array.from({ length: 129 }, () => "")),
			/Too many menu icons/
		);
	} else {
		throw new Error("Unknown menu icon test mode");
	}

	process.stdout.write(`Native menu ${mode} verified\n`);
} finally {
	dispose();

	if (directory) await rm(directory, { recursive: true, force: true });
}

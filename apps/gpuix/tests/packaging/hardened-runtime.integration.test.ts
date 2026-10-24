/**
 * Covers: the compiled Bun runtime loading relocated native addons with hardened runtime.
 * Real: Bun compiler, codesign, runtime entitlements, Sharp and the GPUIX native addon.
 * Doubles: ad-hoc signing instead of Developer ID; no timestamp server, Apple upload or Keychain.
 * Requires: Apple Silicon macOS, built native addon and Bun.
 */
import { expect, it } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appDirectory, nativeLibrary } from "../../native/config";
import { signingCommand } from "../../native/macos-signing";
import { copyImageRuntime } from "../../native/package-resources";

it("runs the compiled JavaScript engine and relocated native dependencies under hardened runtime", async () => {
	if (process.platform !== "darwin" || process.arch !== "arm64")
		throw new Error("Requires Apple Silicon macOS.");

	const directory = await mkdtemp(resolve(tmpdir(), "1git-hardened-runtime-"));
	const contents = resolve(directory, "1git.app/Contents");
	const resources = resolve(contents, "Resources");
	const executable = resolve(contents, "MacOS/1git");
	const addon = resolve(contents, "Frameworks/gpuix-native.node");

	try {
		await mkdir(resolve(contents, "MacOS"), { recursive: true });
		await mkdir(resolve(contents, "Frameworks"));
		await mkdir(resources);
		await copyFile(nativeLibrary, addon);
		await copyImageRuntime(resources);
		const bundle = await Bun.build({
			entrypoints: [resolve(appDirectory, "tests/_shared/package-runtime.ts")],
			target: "bun",
			external: ["sharp"],
			outdir: resources,
			naming: "app.js",
		});

		expect(bundle.success).toBe(true);
		await signingCommand([
			process.execPath,
			"build",
			resolve(appDirectory, "native/packaged-main.ts"),
			"--compile",
			"--compile-autoload-package-json",
			"--no-compile-autoload-dotenv",
			"--no-compile-autoload-bunfig",
			"--outfile",
			executable,
		]);
		const sign = async (path: string, entitlements?: string): Promise<void> => {
			await signingCommand([
				"/usr/bin/codesign",
				"--force",
				"--sign",
				"-",
				"--timestamp=none",
				"--options",
				"runtime",
				...(entitlements ? ["--entitlements", entitlements] : []),
				path,
			]);
		};

		for await (const image of new Bun.Glob(
			"node_modules/@img/**/*.{node,dylib}"
		).scan({ cwd: resources, absolute: true }))
			await sign(image);

		await sign(addon);
		await sign(executable, resolve(appDirectory, "native/macos.entitlements"));
		await signingCommand([
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			executable,
		]);
		expect(await signingCommand([executable])).toContain(
			"Packaged runtime ready"
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);

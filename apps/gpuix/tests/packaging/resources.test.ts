/**
 * Covers: macOS icon metadata and relocatable image dependencies.
 * Real: Sharp's installed native addon, copied into an isolated directory.
 * Doubles: a 1px generated image; no app window or user repository/session.
 */
import { expect, it } from "bun:test";
import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type sharp from "sharp";
import {
	bundleInfoPlist,
	copyImageRuntime,
} from "../../native/package-resources";
import { appDirectory, nativeLibrary } from "../../native/config";

it("links both Icon Composer and legacy icons without changing app defaults", () => {
	const info = bundleInfoPlist("0.0.1");

	expect(info).toContain("<key>CFBundleIconName</key><string>1git</string>");
	expect(info).toContain(
		"<key>CFBundleIconFile</key><string>1git.icns</string>"
	);
	expect(info).toContain("<key>CFBundleExecutable</key><string>1git</string>");
	expect(info).toContain(
		"<key>LSMinimumSystemVersion</key><string>13.0</string>"
	);
	expect(() => bundleInfoPlist("</string>")).toThrow("numeric");
});

it("loads native modules through the compiled launcher after relocation", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "1git-bundle-runtime-"));
	const contents = resolve(directory, "1git.app/Contents");
	const resources = resolve(contents, "Resources");
	const executable = resolve(contents, "MacOS/1git");

	try {
		await mkdir(resolve(contents, "MacOS"), { recursive: true });
		await mkdir(resolve(contents, "Frameworks"));
		await mkdir(resources);
		await copyFile(
			nativeLibrary,
			resolve(contents, "Frameworks/gpuix-native.node")
		);
		await copyImageRuntime(resources);

		const bundle = await Bun.build({
			entrypoints: [resolve(appDirectory, "tests/_shared/package-runtime.ts")],
			target: "bun",
			external: ["sharp"],
			outdir: resources,
			naming: "app.js",
		});

		expect(bundle.success).toBe(true);
		const compile = Bun.spawn(
			[
				process.execPath,
				"build",
				resolve(appDirectory, "native/packaged-main.ts"),
				"--compile",
				"--compile-autoload-package-json",
				"--no-compile-autoload-dotenv",
				"--no-compile-autoload-bunfig",
				"--outfile",
				executable,
			],
			{ stdout: "pipe", stderr: "pipe" }
		);

		const compilerErrors = new Response(compile.stderr).text();

		expect(await compile.exited).toBe(0);
		expect(await compilerErrors).not.toContain("error:");
		const child = Bun.spawn([executable], {
			cwd: directory,
			env: {
				...process.env,
				NAPI_RS_NATIVE_LIBRARY_PATH: "/missing/checkout.node",
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const output = new Response(child.stdout).text();
		const errors = new Response(child.stderr).text();

		expect(await child.exited).toBe(0);
		expect(await output).toContain("Packaged runtime ready");
		expect(await errors).toBe("");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 15000);

it("decodes previews with copied native dependencies outside the checkout", async () => {
	const resources = await realpath(
		await mkdtemp(resolve(tmpdir(), "1git-image-runtime-"))
	);

	try {
		await copyImageRuntime(resources);
		const require = createRequire(resolve(resources, "app.js"));
		const decode: typeof sharp = require("sharp");

		expect(require.resolve("sharp").startsWith(resources)).toBe(true);
		const png = await decode({
			create: { width: 1, height: 1, channels: 4, background: "#ff0000" },
		})
			.png()
			.toBuffer();

		const pixels = await decode(png).raw().toBuffer();

		expect([...pixels]).toEqual([255, 0, 0, 255]);
	} finally {
		await rm(resources, { recursive: true, force: true });
	}
});

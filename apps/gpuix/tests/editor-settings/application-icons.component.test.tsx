/**
 * Covers: real AppKit PNGs, custom bundle icons, invalid paths, reinstall refresh and the image/fallback UI.
 * Real: native renderer, NSWorkspace, PNG decoding and temporary application metadata; no app is launched.
 * Doubles: inert custom bundle resources and the native error case. Requires: patched addon and macOS graphics.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	writeFile,
	copyFile,
	chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { EditorApplicationIcon } from "../../src/feature/editor-settings/editor-application-icon";
import { ApplicationIcons } from "../../src/feature/editor-settings/application-icons";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
let root: TestRoot;
let directory: string;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-app-icons-")));
	root = createTestRoot({ width: 360, height: 180 });
});
afterEach(async () => {
	root.unmount();
	await rm(directory, { recursive: true, force: true });
});
async function settle() {
	for (let n = 0; n < 8; n++) {
		await Bun.sleep(25);
		root.renderer.flush();
	}
}
async function bundle(
	color: string,
	path = join(directory, "Custom Editor.app")
) {
	const resources = join(path, "Contents", "Resources");

	await mkdir(resources, { recursive: true });
	const resource = `Icon-${randomUUID()}.icns`;
	const iconset = join(directory, `${randomUUID()}.iconset`);

	await mkdir(iconset);

	for (const size of [16, 32, 128, 256, 512])
		for (const scale of [1, 2]) {
			const png = await sharp({
				create: {
					width: size * scale,
					height: size * scale,
					channels: 4,
					background: color,
				},
			})
				.composite([
					{
						input: Buffer.from(
							`<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 64 64"><path fill="white" d="${color === "#d93322" ? "M12 12h40v16H12z" : "M24 8h16v48H24z"}"/></svg>`
						),
					},
				])
				.png()
				.toBuffer();

			await writeFile(
				join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
				png
			);
		}

	await execute("/usr/bin/iconutil", [
		"--convert",
		"icns",
		"--output",
		join(resources, resource),
		iconset,
	]);
	const identifier = `dev.1git.icon-fixture.x${createHash("sha256").update(path).digest("hex").slice(0, 16)}`;

	const executable = join(path, "Contents", "MacOS", "Editor");

	await mkdir(join(path, "Contents", "MacOS"), { recursive: true });
	await copyFile("/usr/bin/true", executable);
	await chmod(executable, 0o755);

	await writeFile(
		join(path, "Contents", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>Editor</string><key>CFBundleVersion</key><string>1.0</string><key>CFBundleName</key><string>Custom Editor</string><key>CFBundleIconFile</key><string>${resource}</string></dict></plist>`
	);

	return path;
}
it("reads a real installed app's bounded PNG and rejects invalid or missing application paths", async () => {
	const source = ApplicationIcons.load(
		root.renderer,
		"/System/Library/CoreServices/Finder.app"
	);

	expect(source).toBeDefined();
	const image = Buffer.from(source!.split(",")[1]!, "base64");
	const info = await sharp(image).metadata();

	expect(info).toMatchObject({
		format: "png",
		width: 64,
		height: 64,
		hasAlpha: true,
	});
	expect(image.length).toBeLessThan(256 * 1024);

	for (const path of [
		"relative.app",
		"/usr/bin/open",
		"https://example.test/Editor.app",
		"/Applications/../Finder.app",
		"/Applications/Invalid\0.app",
		"/Applications/Invalid\n.app",
		join(directory, "Missing.app"),
		`/Applications/${"x".repeat(4100)}.app`,
	])
		expect(ApplicationIcons.load(root.renderer, path)).toBeUndefined();
});
it("loads a custom bundle's actual artwork and refreshes the image after reinstalling it", async () => {
	const path = await bundle("#d93322");
	const editors = new ExternalEditors(join(directory, "editors.json"));
	const first = await editors.application(path);
	const source = ApplicationIcons.load(root.renderer, path, first.iconRevision);

	expect(source).toBeDefined();
	const info = await sharp(
		Buffer.from(source!.split(",")[1]!, "base64")
	).metadata();

	expect(info).toMatchObject({ width: 64, height: 64 });

	await rm(path, { recursive: true });
	await bundle("#2266dd", path);
	const second = await editors.application(path);

	expect(second.iconRevision).not.toBe(first.iconRevision);
	const updated = ApplicationIcons.load(
		root.renderer,
		path,
		second.iconRevision
	);

	expect(updated).toBeDefined();
	expect(updated).not.toBe(source);
});
it.each(["light", "dark"] as const)(
	"renders native app artwork and keeps a safe fallback in %s",
	async (appearance) => {
		const path = await bundle("#2266dd");

		const application = await new ExternalEditors(
			join(directory, "editors.json")
		).application(path);

		const render = (app = application) =>
			root.render(
				<AppThemeContext
					value={{ ...appThemes[appearance], commitTypeBadges: true }}
				>
					<div
						style={{
							padding: 20,
							backgroundColor: appThemes[appearance].colors.editorSurface,
							display: "flex",
							flexDirection: "row",
							gap: 12,
						}}
					>
						<EditorApplicationIcon application={app} testId="native-icon" />
						<EditorApplicationIcon testId="system-icon" />
					</div>
				</AppThemeContext>
			);

		render();
		await settle();
		expect(root.renderer.findByTestId("native-icon-image")?.type).toBe("img");
		expect(root.renderer.findByTestId("system-icon-image")).toBeUndefined();

		if (process.env.GPUIX_EDITOR_ICONS_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_EDITOR_ICONS_SCREENSHOT}-${appearance}.png`
			);

		const fallback = spyOn(ApplicationIcons, "load").mockReturnValue(undefined);

		try {
			render({ ...application, iconRevision: "lookup-failed" });
			await settle();
			expect(root.renderer.findByTestId("native-icon-image")).toBeUndefined();
			expect(root.renderer.getAllText()).toContain("C");
		} finally {
			fallback.mockRestore();
		}

		render({ ...application, available: false });
		await settle();
		expect(root.renderer.findByTestId("native-icon-image")).toBeUndefined();
	}
);

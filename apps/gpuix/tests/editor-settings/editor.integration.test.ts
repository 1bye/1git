/**
 * Covers: editor detection, atomic persistence, custom paths, unavailable choices and shared file launch routing.
 * Real: disposable preferences/application metadata, macOS plutil and file containment checks.
 * Doubles: open command and editor handoff; never launches an app or reads user preferences.
 * Requires: macOS with plutil and temporary storage; no graphics or network.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { editorApplication } from "../_shared/editor-application";

const execute = promisify(execFile);
let directory: string;
let file: string;
let preferences: string;
let applicationDirectory: string;
let launches: string[][];
let editors: ExternalEditors;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-editors-")));
	preferences = join(directory, "settings", "editor.json");
	applicationDirectory = join(directory, "Applications");
	file = join(directory, "file ' ; $().txt");
	await mkdir(applicationDirectory);
	await writeFile(file, "unchanged");
	launches = [];
	editors = new ExternalEditors(
		preferences,
		async (command, args) => {
			if (command === "/usr/bin/open") {
				launches.push([...args]);

				return "";
			}

			const { stdout } = await execute(command, [...args], {
				encoding: "utf8",
				timeout: 10_000,
			});

			return stdout;
		},
		[applicationDirectory]
	);
});
afterEach(async () => {
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

it("keeps the default text-editor association when no preference exists", async () => {
	expect(await editors.options()).toEqual({ selected: null, applications: [] });
	await editors.open(file);

	expect(launches).toEqual([["-t", file]]);
	expect(await readFile(file, "utf8")).toBe("unchanged");
});

it("detects installed editors and restores a private preference in a fresh owner", async () => {
	const zed = await editorApplication(applicationDirectory, "Zed.app");
	const cursor = await editorApplication(applicationDirectory, "Cursor.app");

	await editorApplication(applicationDirectory, "Unrelated.app");

	expect(
		(await editors.options()).applications.map((item) => item.path)
	).toEqual([cursor, zed]);
	await editors.save(zed);
	const restored = new ExternalEditors(preferences);

	expect(restored.load()).toBe(zed);
	expect((await stat(preferences)).mode & 0o777).toBe(0o600);
	expect(JSON.parse(await readFile(preferences, "utf8"))).toEqual({
		version: 1,
		application: zed,
	});
	await editors.open(file);
	expect(launches).toEqual([["-a", zed, file]]);
});

it("accepts a custom application and passes its literal path as an argument, not a shell command", async () => {
	const custom = await editorApplication(directory, "My Editor ' ; $().app");

	await editors.save(custom);

	expect((await editors.options()).applications).toEqual([
		{ path: custom, name: "My Editor ' ; $()", available: true },
	]);
	await editors.open(file);
	expect(launches).toEqual([["-a", custom, file]]);

	await editors.save(null);
	await editors.open(file);
	expect(launches[1]).toEqual(["-t", file]);
});

it("retains an unavailable saved choice and never silently falls back to another editor", async () => {
	const zed = await editorApplication(applicationDirectory, "Zed.app");

	await editors.save(zed);
	await rm(zed, { recursive: true });

	expect(await editors.options()).toEqual({
		selected: zed,
		applications: [{ path: zed, name: "Zed", available: false }],
	});
	await expect(editors.open(file)).rejects.toThrow(
		"selected editor is unavailable"
	);
	expect(launches).toEqual([]);
	expect(editors.load()).toBe(zed);

	await editors.save(null);
	await editors.open(file);
	expect(launches).toEqual([["-t", file]]);
});

it("rejects files, folders and malformed application bundles without changing the saved choice", async () => {
	const zed = await editorApplication(applicationDirectory, "Zed.app");

	await editors.save(zed);
	const before = await readFile(preferences, "utf8");
	const invalid = await editorApplication(directory, "Invalid.app");

	await writeFile(join(invalid, "Contents", "Info.plist"), "not a plist");

	for (const path of [file, directory, invalid, "relative.app"]) {
		await expect(editors.save(path)).rejects.toThrow();
		expect(await readFile(preferences, "utf8")).toBe(before);
	}

	expect(launches).toEqual([]);
});

it("leaves malformed, unsupported and oversized preferences untouched", async () => {
	await mkdir(join(directory, "settings"));

	for (const content of [
		"{broken",
		JSON.stringify({ version: 2, application: null }),
		JSON.stringify({ version: 1, application: "../editor.app" }),
		" ".repeat(8193),
	]) {
		await writeFile(preferences, content);
		await expect(editors.save(null)).rejects.toThrow(
			"saved file was left unchanged"
		);
		await expect(editors.open(file)).rejects.toThrow(
			"saved file was left unchanged"
		);
		expect(await readFile(preferences, "utf8")).toBe(content);
	}

	expect(launches).toEqual([]);
});

it("routes both conflict and file-menu requests through the editor owner, after containment checks", async () => {
	const open = spyOn(ExternalEditors.prototype, "open").mockResolvedValue();

	await RepositoryConflicts.openEditor(directory, "file ' ; $().txt");
	await RepositoryFileActions.open(directory, "file ' ; $().txt", "editor");

	expect(open.mock.calls).toEqual([[file], [file]]);
	open.mockClear();
	await symlink(file, join(directory, "link.txt"));

	for (const path of ["../outside.txt", "link.txt", "Applications"])
		await expect(
			RepositoryConflicts.openEditor(directory, path)
		).rejects.toThrow("regular files inside");

	expect(open).not.toHaveBeenCalled();
});

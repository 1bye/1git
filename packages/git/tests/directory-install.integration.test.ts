/**
 * Covers: checked directory identity and exclusive repository-file installation across path replacements.
 * Real: filesystem descriptors and native exclusive rename operations.
 * Doubles: a filesystem-read scheduling hook for the concurrent destination swap.
 * Requires: Bun on macOS or Linux and writable temporary storage.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import files from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DirectoryInstall } from "../src/directory-install.js";

let root: string;

afterEach(async () => {
	if (root) await files.rm(root, { recursive: true, force: true });
});

async function fixture() {
	root = await files.realpath(
		await files.mkdtemp(join(tmpdir(), "1git-install-"))
	);
	const source = join(root, "prepared");
	const destination = join(root, "selected");

	await files.mkdir(source);
	await files.mkdir(destination);
	await files.writeFile(join(source, "file"), "prepared\n");
	const identity = await files.lstat(destination);

	return { source, destination, identity };
}

it("does not follow a destination symlink installed after opening its descriptor", async () => {
	const { source, destination, identity } = await fixture();
	const outside = join(root, "outside");
	const original = join(root, "original");

	await files.mkdir(outside);
	const handle = await files.open(destination, "r");
	const prototype = Object.getPrototypeOf(handle);
	const stat = handle.stat;

	await handle.close();
	let swapped = false;

	const read = spyOn(prototype, "stat").mockImplementation(async function (
		this: FileHandle
	) {
		const current = await stat.call(this);

		if (
			!swapped &&
			current.dev === identity.dev &&
			current.ino === identity.ino
		) {
			swapped = true;
			await files.rename(destination, original);
			await files.symlink(outside, destination);
		}

		return current;
	});

	try {
		await DirectoryInstall.run(source, destination, identity);
	} finally {
		read.mockRestore();
	}

	expect(swapped).toBe(true);
	expect(await files.readdir(outside)).toEqual([]);
	expect(await files.readFile(join(original, "file"), "utf8")).toBe(
		"prepared\n"
	);
});

it("refuses changed directory identities and never replaces an existing entry", async () => {
	const { source, destination, identity } = await fixture();
	const other = join(root, "other");

	await files.mkdir(other);
	await expect(DirectoryInstall.run(source, other, identity)).rejects.toThrow(
		"changed"
	);
	expect(await files.readdir(other)).toEqual([]);
	await files.writeFile(join(destination, "file"), "existing\n");
	await expect(
		DirectoryInstall.run(source, destination, identity)
	).rejects.toThrow("without replacing");
	expect(await files.readFile(join(destination, "file"), "utf8")).toBe(
		"existing\n"
	);
	expect(await files.readFile(join(source, "file"), "utf8")).toBe("prepared\n");
});

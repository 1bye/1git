/**
 * Covers: private atomic session storage, restarts, invalid-data preservation and recoverable write failures.
 * Real: local filesystem, a separate Bun process and native draft editor/exit lifecycle.
 * Doubles: repository reads and session documents; no Git or user application data.
 * Requires: writable temporary storage and patched GPUIX/macOS graphics for the exit test.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceSessionStore } from "../../src/feature/workspace-tabs/lib/workspace-session-store";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";

let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "gpuix-session-"));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});
const document = (): WorkspaceSessionDocument => ({
	version: 1,
	tabs: [
		{ id: "workspace-1", path: "/test/linked", draft: "Keep my draft\n\nBody" },
	],
	activeId: "workspace-1",
});

it("flushes the last typed draft on process exit before autosave and restores it in a fresh process owner", () => {
	const path = join(directory, "session.json");

	new WorkspaceSessionStore(path).save(document());
	execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"./tests/_shared/session-exit.tsx",
			path,
		],
		{
			cwd: resolve(import.meta.dir, "../.."),
			timeout: 10_000,
		}
	);
	expect(new WorkspaceSessionStore(path).load().document?.tabs[0]?.draft).toBe(
		"exit"
	);
});

it("round-trips a private file between independent store instances and replaces it without leftover temporary files", () => {
	const path = join(directory, "state", "session.json");
	const first = new WorkspaceSessionStore(path);

	expect(first.load()).toEqual({});
	first.save(document());
	const next = new WorkspaceSessionStore(path);

	expect(next.load().document).toEqual(document());
	next.save({ version: 1, tabs: [], activeId: null });
	expect(new WorkspaceSessionStore(path).load().document?.tabs).toEqual([]);
	expect(readdirSync(join(directory, "state"))).toEqual(["session.json"]);

	if (process.platform !== "win32") {
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(join(directory, "state")).mode & 0o777).toBe(0o700);
	}
});

it("leaves corrupt, future-version and oversized sessions unchanged and disables writes", () => {
	const path = join(directory, "session.json");

	for (const original of [
		"{broken",
		'{"version":99,"tabs":[]}',
		"x".repeat(1024 * 1024 + 1),
	]) {
		writeFileSync(path, original);
		const store = new WorkspaceSessionStore(path);

		expect(store.load().error).toContain("left unchanged");
		expect(() => store.save(document())).toThrow("disabled");
		expect(readFileSync(path, "utf8")).toBe(original);
	}
});

it("reports write failures and oversized drafts without replacing the last saved session, then allows retry", () => {
	const path = join(directory, "session.json");
	const store = new WorkspaceSessionStore(path);

	store.save(document());
	const previous = readFileSync(path, "utf8");

	expect(() =>
		store.save({
			...document(),
			tabs: [{ id: "workspace-1", path: null, draft: "x".repeat(1024 * 1024) }],
		})
	).toThrow("too large");
	expect(readFileSync(path, "utf8")).toBe(previous);
	const blockedPath = join(directory, "blocked");

	mkdirSync(blockedPath);
	const retry = new WorkspaceSessionStore(blockedPath);

	expect(() => retry.save(document())).toThrow();
	expect(readdirSync(directory).sort()).toEqual(["blocked", "session.json"]);
	rmSync(blockedPath, { recursive: true });
	retry.save(document());
	expect(new WorkspaceSessionStore(blockedPath).load().document).toEqual(
		document()
	);
});

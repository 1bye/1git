/**
 * Covers: shortcut defaults, canonical native events, reserved keys, conflicts and saved preference validation.
 * Real: shortcut model and session parser.
 * Doubles: none.
 * Requires: none; no native renderer, Git or user files.
 */
import { expect, it } from "bun:test";
import { Keybinds, keybindCommands } from "../../src/feature/keybinds/keybinds";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";

it("uses unique defaults and accepts each editable command's default", () => {
	const keys = keybindCommands.flatMap((command) =>
		Keybinds.bindings(command, {})
	);

	expect(new Set(keys).size).toBe(keys.length);

	for (const command of keybindCommands) {
		if (!command.fixed)
			expect(Keybinds.error({}, command.id, command.key)).toBeNull();
	}
});

it("formats native modifier order, arrows, punctuation and a literal hyphen", () => {
	expect(
		Keybinds.fromEvent({
			key: "k",
			modifiers: { cmd: true, shift: true, ctrl: false, alt: false },
		})
	).toBe("shift-cmd-k");
	expect(Keybinds.format("shift-cmd-k")).toBe("⇧⌘K");
	expect(Keybinds.format("alt-cmd-left")).toBe("⌥⌘←");
	expect(Keybinds.format("cmd-enter")).toBe("⌘↩");
	expect(Keybinds.format("cmd-,")).toBe("⌘,");
	expect(Keybinds.format("cmd--")).toBe("⌘-");
	expect(Keybinds.format("e")).toBe("E");
	expect(Keybinds.fromEvent({ key: "cmd" })).toBeNull();
});

it("rejects conflicts, system shortcuts, typing keys and malformed combinations", () => {
	expect(Keybinds.error({}, "open", "cmd-p")).toContain("Find repository");
	expect(Keybinds.error({}, "open", "ctrl-,")).toContain("Open Settings");
	expect(Keybinds.error({}, "open", "cmd-c")).toContain("reserved");
	expect(Keybinds.error({}, "open", "cmd-q")).toContain("reserved");
	expect(Keybinds.error({}, "open", "alt-left")).toContain("reserved");
	expect(Keybinds.error({}, "open", "ctrl-shift-z")).toContain("reserved");
	expect(Keybinds.error({}, "open", "alt-shift-left")).toContain("reserved");
	expect(
		Keybinds.error({ "previous-tab": "cmd-k" }, "open", "cmd-left")
	).toContain("reserved");
	expect(Keybinds.error({}, "open", "k")).toContain("Include Command");
	expect(Keybinds.error({}, "open", "shift-k")).toContain("Include Command");

	for (const binding of [
		"cmd-escape",
		"cmd-tab",
		"cmd-cmd-k",
		"cmd-shift-k",
		"cmd-",
		"cmd-💼",
	])
		expect(Keybinds.error({}, "open", binding)).not.toBeNull();

	expect(Keybinds.error({}, "settings", "cmd-k")).toContain(
		"cannot be changed"
	);
	expect(Keybinds.error({}, "open", "shift-cmd-k")).toBeNull();
});

it("releases an action's old shortcut and refuses a reset if another action uses it", () => {
	const overrides = { "quick-open": "cmd-k", open: "cmd-p" };

	expect(Keybinds.error({ "quick-open": "cmd-k" }, "open", "cmd-p")).toBeNull();
	expect(Keybinds.error(overrides, "quick-open", "cmd-p")).toContain(
		"Open repository"
	);
	expect(Keybinds.parse(overrides)).toEqual(overrides);
	expect(Keybinds.parse({ "quick-open": "cmd-o", open: "cmd-p" })).toEqual({
		"quick-open": "cmd-o",
		open: "cmd-p",
	});
});

it("ignores unknown IDs and safely restores defaults for corrupt or conflicting saved bindings", () => {
	expect(Keybinds.parse(undefined)).toEqual({});
	expect(Keybinds.parse(["cmd-k"])).toEqual({});
	expect(Keybinds.parse({ unknown: "cmd-k", open: "cmd-o" })).toEqual({});
	expect(Keybinds.parse({ open: "cmd-q" })).toEqual({});
	expect(Keybinds.parse({ open: "cmd-p" })).toEqual({});
	expect(Keybinds.parse({ settings: "cmd-k" })).toEqual({});
	expect(Keybinds.parse({ open: "cmd-k", refresh: "cmd-k" })).toEqual({});
});

it("round-trips shortcut preferences without losing older sessions or drafts", () => {
	const document = {
		version: 1,
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep draft" }],
		activeId: "workspace-1",
	};

	const saved = WorkspaceSession.parse(
		JSON.stringify({ ...document, keybinds: { "quick-open": "cmd-k" } })
	);

	expect(saved.keybinds).toEqual({ "quick-open": "cmd-k" });
	expect(saved.tabs[0]?.draft).toBe("Keep draft");
	expect(
		WorkspaceSession.parse(JSON.stringify(document)).keybinds
	).toBeUndefined();
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ ...document, keybinds: { open: "cmd-c" } })
		).tabs[0]?.draft
	).toBe("Keep draft");
});

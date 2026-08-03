import { describe, expect, test } from "bun:test";
import {
	getCommandLensHintRect,
	insetCommandLensRect,
} from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensNavigationTarget,
	getCommandLensNavigationAction,
	getCommandLensNavigationTargets,
	getInitialCommandLensNavigationTarget,
	getNextCommandLensNavigationTarget,
	isCommandLensNavigationKey,
} from "@/fixture/command-lens/lib/command-lens-navigation.js";
import {
	commandLensAriaKeyShortcut,
	formatCommandLensCommand,
	getCommandLensDisplayCommands,
	getCommandLensNumberKey,
	hasCommandLensOptionMode,
	matchesCommandLensCommand,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";

const keyboardEvent = (
	input: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">
): KeyboardEvent =>
	({
		altKey: false,
		code: "",
		ctrlKey: false,
		metaKey: true,
		shiftKey: false,
		...input,
	}) as KeyboardEvent;

describe("command lens shortcuts", () => {
	test("numbers the first eight tabs and reserves nine for the last tab", () => {
		expect(getCommandLensNumberKey(0, 12)).toBe("1");
		expect(getCommandLensNumberKey(7, 12)).toBe("8");
		expect(getCommandLensNumberKey(8, 12)).toBeNull();
		expect(getCommandLensNumberKey(11, 12)).toBe("9");
	});

	test("matches Option-modified digits by physical code", () => {
		const command = {
			altKey: true,
			key: "1",
			label: "Open in background",
		} as const;
		const event = keyboardEvent({
			altKey: true,
			code: "Digit1",
			key: "¡",
		});

		expect(matchesCommandLensCommand(event, command)).toBe(true);
		expect(formatCommandLensCommand(command)).toEqual(["⌥", "1"]);
		expect(formatCommandLensCommand(command, true)).toEqual(["1"]);
		expect(commandLensAriaKeyShortcut(command)).toBe("Meta+Alt+1");
	});

	test("presents one command per target for the current Option mode", () => {
		const commands = [
			{ key: "1", label: "Open" },
			{ altKey: true, key: "1", label: "Open in background" },
		] as const;

		expect(getCommandLensDisplayCommands(commands, false)).toEqual([
			commands[0],
		]);
		expect(getCommandLensDisplayCommands(commands, true)).toEqual([
			commands[1],
		]);
		expect(hasCommandLensOptionMode(commands)).toBe(true);
	});

	test("matches Option-modified letters by physical code", () => {
		const command = {
			altKey: true,
			key: "o",
			label: "Clone from URL",
		} as const;

		expect(
			matchesCommandLensCommand(
				keyboardEvent({ altKey: true, code: "KeyO", key: "ø" }),
				command
			)
		).toBe(true);
	});

	test("does not capture commands with unrelated modifiers", () => {
		const command = { key: "k", label: "Search" } as const;

		expect(
			matchesCommandLensCommand(keyboardEvent({ key: "k" }), command)
		).toBe(true);
		expect(
			matchesCommandLensCommand(
				keyboardEvent({ key: "k", shiftKey: true }),
				command
			)
		).toBe(false);
	});
});

describe("command lens geometry", () => {
	const anchor = {
		height: 40,
		left: 100,
		top: 60,
		width: 160,
	};
	const viewport = { height: 300, width: 400 };

	test("keeps a preferred hint beside its target when there is room", () => {
		const hint = getCommandLensHintRect(
			anchor,
			64,
			28,
			"floating",
			"right",
			viewport
		);

		expect(hint.left).toBeGreaterThan(anchor.left + anchor.width);
		expect(hint.top).toBe(66);
	});

	test("flips a hint instead of clipping it outside the viewport", () => {
		const edgeAnchor = { ...anchor, left: 330, width: 60 };
		const hint = getCommandLensHintRect(
			edgeAnchor,
			72,
			28,
			"floating",
			"right",
			viewport
		);

		expect(hint.left + hint.width).toBeLessThan(edgeAnchor.left);
	});

	test("places compact hints inside controls and in a stable list gutter", () => {
		const inlineHint = getCommandLensHintRect(
			anchor,
			32,
			22,
			"inline-end",
			"right",
			viewport
		);
		const gutterHint = getCommandLensHintRect(
			anchor,
			24,
			22,
			"gutter-start",
			"right",
			viewport
		);

		expect(inlineHint.left).toBe(220);
		expect(inlineHint.top).toBe(69);
		expect(gutterHint.left).toBe(67);
		expect(gutterHint.top).toBe(69);
	});

	test("insets a target highlight without moving its center", () => {
		const insetRect = insetCommandLensRect(anchor, 4, 4);

		expect(insetRect).toEqual({
			height: 32,
			left: 104,
			top: 64,
			width: 152,
		});
	});
});

describe("command lens navigation", () => {
	const target = (
		id: string,
		group: string,
		order: number,
		left: number,
		top: number,
		orientation: "horizontal" | "vertical" = "vertical",
		isDefault = false
	): CommandLensNavigationTarget => ({
		commands: [{ key: String(order + 1), label: `Open ${id}` }],
		id,
		navigationAction: { label: `Open ${id}`, onInvoke: () => undefined },
		navigationDefault: isDefault,
		navigationGroup: group,
		navigationOrder: order,
		navigationOrientation: orientation,
		rect: { height: 32, left, top, width: 160 },
	});

	test("starts from an explicit default or currently focused target", () => {
		const targets = [
			target("first", "actions", 0, 20, 100),
			target("default", "actions", 1, 20, 140, "vertical", true),
		];

		expect(getInitialCommandLensNavigationTarget(targets, null)?.id).toBe(
			"default"
		);
		expect(getInitialCommandLensNavigationTarget(targets, "first")?.id).toBe(
			"first"
		);
	});

	test("moves in explicit order inside vertical and horizontal groups", () => {
		const actions = [
			target("create", "actions", 0, 20, 100),
			target("clone", "actions", 1, 20, 140),
		];
		const tabs = [
			target("tab-1", "tabs", 0, 200, 20, "horizontal"),
			target("tab-2", "tabs", 1, 380, 20, "horizontal"),
		];

		expect(
			getNextCommandLensNavigationTarget(actions, "create", "ArrowDown")?.id
		).toBe("clone");
		expect(
			getNextCommandLensNavigationTarget(tabs, "tab-2", "ArrowLeft")?.id
		).toBe("tab-1");
		expect(
			getNextCommandLensNavigationTarget(tabs, "tab-2", "ArrowRight")?.id
		).toBe("tab-2");
	});

	test("moves spatially between columns without disturbing list order", () => {
		const targets = [
			target("create", "actions", 0, 20, 100),
			target("clone", "actions", 1, 20, 140),
			target("search", "repositories", -1, 300, 90),
			target("repo", "repositories", 0, 300, 140),
		];

		expect(
			getNextCommandLensNavigationTarget(targets, "clone", "ArrowRight")?.id
		).toBe("repo");
		expect(
			getNextCommandLensNavigationTarget(targets, "repo", "ArrowLeft")?.id
		).toBe("clone");
	});

	test("offers alternate navigation actions only while Option is held", () => {
		const primaryOnly = target("create", "actions", 0, 20, 100);
		const repository = {
			...target("repo", "repositories", 0, 300, 140),
			navigationAlternateAction: {
				label: "Open repo in background",
				onInvoke: () => undefined,
			},
		};

		expect(
			getCommandLensNavigationTargets([primaryOnly, repository], true)
		).toEqual([repository]);
		expect(getCommandLensNavigationAction(repository, false)?.label).toBe(
			"Open repo"
		);
		expect(getCommandLensNavigationAction(repository, true)?.label).toBe(
			"Open repo in background"
		);
		expect(isCommandLensNavigationKey("ArrowDown")).toBe(true);
		expect(isCommandLensNavigationKey("Enter")).toBe(false);
	});
});

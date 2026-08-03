import { describe, expect, test } from "bun:test";
import { getCommandLensHintRect } from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	commandLensAriaKeyShortcut,
	formatCommandLensCommand,
	getCommandLensDisplayCommands,
	getCommandLensNumberKey,
	hasCommandLensShiftMode,
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

	test("matches shifted digits by physical code", () => {
		const command = {
			key: "1",
			label: "Open in background",
			shiftKey: true,
		} as const;
		const event = keyboardEvent({
			code: "Digit1",
			key: "!",
			shiftKey: true,
		});

		expect(matchesCommandLensCommand(event, command)).toBe(true);
		expect(formatCommandLensCommand(command)).toEqual(["⇧", "1"]);
		expect(formatCommandLensCommand(command, true)).toEqual(["1"]);
		expect(commandLensAriaKeyShortcut(command)).toBe("Meta+Shift+1");
	});

	test("presents one command per target for the current Shift mode", () => {
		const commands = [
			{ key: "1", label: "Open" },
			{ key: "1", label: "Open in background", shiftKey: true },
		] as const;

		expect(getCommandLensDisplayCommands(commands, false)).toEqual([
			commands[0],
		]);
		expect(getCommandLensDisplayCommands(commands, true)).toEqual([
			commands[1],
		]);
		expect(hasCommandLensShiftMode(commands)).toBe(true);
	});

	test("does not capture commands with unrelated modifiers", () => {
		const command = { key: "k", label: "Search" } as const;

		expect(
			matchesCommandLensCommand(keyboardEvent({ key: "k" }), command)
		).toBe(true);
		expect(
			matchesCommandLensCommand(
				keyboardEvent({ altKey: true, key: "k" }),
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
});

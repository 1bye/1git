/**
 * Covers: selection, disabled options, popup dismissal, labels, and state styles.
 * Real: styled Select wrappers, GPUIX primitives, and native rendering/events.
 * Doubles: none.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { useState } from "react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../src/select";
import { clickElement, elementByTestId } from "../_shared/native-elements";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 500, height: 400 });
});
afterEach(() => {
	root.unmount();
});

function BranchSelect({ disabled = false }: { disabled?: boolean }) {
	const [value, setValue] = useState("main");

	return (
		<Select
			value={value}
			onValueChange={setValue}
			disabled={disabled}
			items={[
				{ value: "main", label: "Main branch" },
				{ value: "develop", label: "Development" },
			]}
		>
			<SelectTrigger
				testId="trigger"
				aria-label="Branch"
				style={({ open }) => ({ borderRadius: open ? 10 : 6 })}
			>
				<SelectValue testId="value" />
			</SelectTrigger>
			<SelectContent testId="content">
				<SelectItem testId="main" value="main">
					Main branch
				</SelectItem>
				<SelectItem testId="archived" value="archived" disabled>
					Archived
				</SelectItem>
				<SelectItem
					testId="develop"
					value="develop"
					style={({ selected }) => ({
						color: selected ? "#aabbcc" : "#ffffff",
					})}
				>
					Development
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

it("selects with the keyboard, skips disabled items, and restores trigger focus", () => {
	root.render(<BranchSelect />);
	const trigger = elementByTestId(root.renderer, "trigger");

	root.renderer.nativeSimulateKeystrokes(trigger.id, "enter");
	expect(root.renderer.findByTestId("content")).toBeDefined();
	expect(elementByTestId(root.renderer, "trigger").style.borderRadius).toBe(10);
	root.renderer.simulateKeystrokes("down enter");

	expect(root.renderer.findByTestId("content")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Development");
	expect(root.renderer.getFocusedElementId()).toBe(trigger.id);
	root.renderer.simulateKeystrokes("enter");
	expect(elementByTestId(root.renderer, "develop").style.color).toBe("#aabbcc");
});

it("ignores disabled options and selects an enabled option by mouse", () => {
	root.render(<BranchSelect />);

	clickElement(root.renderer, "trigger");
	clickElement(root.renderer, "archived");
	expect(root.renderer.findByTestId("content")).toBeDefined();
	clickElement(root.renderer, "develop");
	expect(root.renderer.findByTestId("content")).toBeUndefined();
	expect(root.renderer.getPaintedText()).toContain("Development");
});

it("dismisses with Escape and leaves the selected value unchanged", () => {
	root.render(<BranchSelect />);

	clickElement(root.renderer, "trigger");
	root.renderer.simulateKeystrokes("down escape");
	expect(root.renderer.findByTestId("content")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Main branch");
});

it("does not open a disabled select", () => {
	root.render(<BranchSelect disabled />);
	const trigger = elementByTestId(root.renderer, "trigger");

	clickElement(root.renderer, "trigger");
	root.renderer.nativeSimulateKeystrokes(trigger.id, "enter down space");
	expect(root.renderer.findByTestId("content")).toBeUndefined();
});

it("supports an uncontrolled value and a placeholder", () => {
	const values: string[] = [];

	root.render(
		<Select onValueChange={(value) => values.push(value)}>
			<SelectTrigger testId="trigger" aria-label="Branch">
				<SelectValue placeholder="Choose a branch" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem testId="main" value="main">
					main
				</SelectItem>
			</SelectContent>
		</Select>
	);
	expect(root.renderer.getPaintedText()).toContain("Choose a branch");

	clickElement(root.renderer, "trigger");
	clickElement(root.renderer, "main");
	expect(values).toEqual(["main"]);
	expect(root.renderer.getPaintedText()).toContain("main");
});

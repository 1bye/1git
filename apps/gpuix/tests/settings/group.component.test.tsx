/**
 * Covers: independent row/action activation, Space arming and preview layout.
 * Real: shared Settings cards, native focus and keyboard dispatch.
 * Requires: built native addon and macOS graphics access.
 */
import { expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { Button } from "@1git/gpuix-ui/button";
import {
	SettingsGroup,
	SettingsGroupRow,
} from "../../src/feature/settings/settings-group";
import {
	SettingsPage,
	SettingsPreview,
	SettingsSplit,
} from "../../src/feature/settings/settings-layout";

test("keeps row activation separate from trailing actions and gives previews a scrolling body", () => {
	const root = createTestRoot({ width: 1000, height: 500 });
	let edits = 0;
	let removals = 0;

	try {
		root.render(
			<SettingsSplit
				list={
					<SettingsPage title="Example" testId="page">
						<SettingsGroup title="Items">
							<SettingsGroupRow
								testId="row"
								label="Item"
								onPress={() => edits++}
								trailing={
									<Button testId="remove" onPress={() => removals++}>
										Remove
									</Button>
								}
							/>
							<SettingsGroupRow
								testId="disabled"
								label="Unavailable"
								disabled
								onPress={() => edits++}
							/>
						</SettingsGroup>
					</SettingsPage>
				}
				panel={
					<SettingsPreview>
						<div style={{ height: 1200, flexShrink: 0 }}>
							<text>Preview content</text>
						</div>
					</SettingsPreview>
				}
			/>
		);
		const node = (id: string) => {
			const value = root.renderer.findByTestId(id);

			if (!value) throw new Error(`Missing ${id}`);

			return value;
		};

		root.renderer.nativeSimulateKeyDown(node("remove").id, "enter");
		expect(removals).toBe(1);
		expect(edits).toBe(0);
		root.renderer.nativeSimulateKeyDown(node("row").id, "enter");
		expect(edits).toBe(1);
		root.renderer.nativeSimulateKeyDown(node("row").id, "space");
		root.renderer.nativeSimulateKeyDown(node("row").id, "space", true);
		expect(edits).toBe(1);
		root.renderer.nativeSimulateKeyUp(node("row").id, "space");
		expect(edits).toBe(2);
		expect(node("disabled").customProps?.tabIndex).toBeUndefined();
		const preview = node("settings-preview");

		expect(preview.customProps?.["aria-label"]).toBe("Preview");
		expect(root.renderer.getElementBounds(preview.id)?.height).toBe(500);
	} finally {
		root.unmount();
	}
});

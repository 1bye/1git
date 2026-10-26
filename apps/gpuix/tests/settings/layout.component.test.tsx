/**
 * Covers: shared heading hierarchy, equal pane widths and pinned editor actions.
 * Real: Settings layouts and native GPUIX layout/scrolling.
 * Requires: built native addon and macOS graphics access.
 */
import { afterEach, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import {
	SettingsPage,
	SettingsSection,
	SettingsSplit,
} from "../../src/feature/settings/settings-layout";

const root = createTestRoot({ width: 1000, height: 500 });

afterEach(() => root.unmount());

test("shares equal panes and keeps editor actions outside its scrolling body", () => {
	root.render(
		<SettingsSplit
			list={
				<SettingsPage
					title="Preferences"
					testId="page"
					scrollTestId="page-scroll"
					headerTestId="page-header"
				>
					<SettingsSection title="Options">
						<div style={{ height: 1200, flexShrink: 0 }}>
							<text>Option</text>
						</div>
					</SettingsSection>
				</SettingsPage>
			}
			panel={{
				title: "Edit option",
				label: "Edit option",
				testId: "panel",
				scrollTestId: "scroll",
				footerTestId: "footer",
				body: (
					<div style={{ height: 1200, flexShrink: 0 }}>
						<text>Long form</text>
					</div>
				),
				footer: <text>Save</text>,
			}}
		/>
	);
	root.renderer.flush();
	const bounds = (id: string) => {
		const element = root.renderer.findByTestId(id);

		if (!element) throw new Error(`Missing ${id}`);

		const result = root.renderer.getElementBounds(element.id);

		if (!result) throw new Error(`Missing ${id} bounds`);

		return result;
	};

	const page = bounds("page");
	const panel = bounds("panel");

	expect(Math.abs(page.width - panel.width)).toBeLessThanOrEqual(1);
	expect(panel.height).toBe(500);
	const footer = bounds("footer");

	expect(footer.y + footer.height).toBeLessThanOrEqual(500);
	const scroll = root.renderer.findByTestId("scroll");

	if (!scroll) throw new Error("Missing editor scroll");

	root.renderer.scrollTo(scroll.id, 0, -900);
	root.renderer.flush();
	expect(bounds("footer")).toEqual(footer);
	const header = bounds("page-header");
	const pageScroll = root.renderer.findByTestId("page-scroll");

	if (!pageScroll) throw new Error("Missing list scroll");

	root.renderer.scrollTo(pageScroll.id, 0, -900);
	root.renderer.flush();
	expect(bounds("page-header")).toEqual(header);
});

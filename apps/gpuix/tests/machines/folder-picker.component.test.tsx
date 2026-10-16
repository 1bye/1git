/**
 * Covers: remote folder dialog layout, navigation, hidden folders, errors, new destinations and keyboard cancellation.
 * Real: remote folder dialog, shared modal behavior and native GPUIX rendering/input.
 * Doubles: saved-machine directory reads; no SSH, credentials, user files or Git writes.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Button } from "@1git/gpuix-ui/button";
import { RemoteFolderPicker } from "../../src/feature/machines/remote-folder-picker";
import { MachineContext } from "../../src/feature/machines/machine-context";
import { Machines } from "../../src/feature/machines/machines";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { MachineStore } from "../../src/feature/machines/machine-store";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { windowOptions } from "../../src/window-options";

const id = "00000000-0000-4000-8000-000000000001";
const at = (path: string) => MachineLocation.encode(id, path);
let root: TestRoot;

function Fixture({
	service,
	select,
	appearance = "dark",
	initialName,
}: {
	service: Machines;
	select: (path: string) => void;
	appearance?: "light" | "dark";
	initialName?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<AppThemeContext
			value={{ ...appThemes[appearance], commitTypeBadges: true }}
		>
			<MachineContext value={service}>
				<div
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: appThemes[appearance].colors.editorSurface,
					}}
				>
					<Button
						tokens={appThemes[appearance].tokens}
						testId="browse"
						onPress={() => setOpen(true)}
					>
						Browse folders
					</Button>
					{open ? (
						<RemoteFolderPicker
							location={at("/home/test")}
							title="Choose a folder"
							initialName={initialName}
							onClose={() => setOpen(false)}
							onSelect={select}
						/>
					) : null}
				</div>
			</MachineContext>
		</AppThemeContext>
	);
}

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

function click(id: string) {
	const box = root.renderer.getElementBounds(node(id).id)!;

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
function enter(id: string, text: string) {
	click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...text].join(" "));
	root.renderer.flush();
}
async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(20);
		root.renderer.clockFastForward(200);
		root.renderer.flush();
	}
}
function service() {
	const machine = new Machines(new MachineStore("/unused/machines.json"));

	spyOn(machine, "name").mockReturnValue("Devbox");
	spyOn(machine, "home").mockReturnValue("/home/test");
	const read = spyOn(machine, "listDirectory").mockImplementation(
		async (path, hidden) => ({
			path,
			parent: at(path === at("/home/test") ? "/home" : "/home/test"),
			entries:
				path === at("/home/test")
					? [
							{ name: "projects", path: at("/home/test/projects") },
							...(hidden
								? [{ name: ".config", path: at("/home/test/.config") }]
								: []),
						]
					: [],
			limited: false,
		})
	);

	return { machine, read };
}

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

for (const appearance of ["light", "dark"] as const) {
	it(`navigates folders and keeps a new destination inside the minimum ${appearance} window`, async () => {
		const { machine, read } = service();
		const select = mock();

		root.render(
			<Fixture
				service={machine}
				select={select}
				appearance={appearance}
				initialName=""
			/>
		);
		click("browse");
		await settle();
		click("remote-folder-projects");
		await settle();
		expect(node("remote-folder-path").customProps?.value).toBe(
			"/home/test/projects"
		);
		expect(root.renderer.getAllText()).toContain("No folders here.");
		enter("remote-folder-name", "../escape");
		click("remote-folder-select");
		expect(select).not.toHaveBeenCalled();
		enter("remote-folder-name", "new-repository");
		const dialog = root.renderer.getElementBounds(
			node("remote-folder-picker").id
		)!;

		const footer = root.renderer.getElementBounds(
			node("remote-folder-select").id
		)!;

		expect(dialog.width).toBe(560);
		expect(dialog.y).toBeGreaterThanOrEqual(12);
		expect(dialog.y + dialog.height).toBeLessThanOrEqual(628);
		expect(footer.y + footer.height).toBeLessThanOrEqual(
			dialog.y + dialog.height
		);
		const screenshot = process.env.GPUIX_REMOTE_FOLDERS_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.png`);

		click("remote-folder-select");
		expect(select).toHaveBeenCalledWith(
			at("/home/test/projects/new-repository")
		);
		expect(read).toHaveBeenCalledTimes(2);
	});
}

it("supports Home/Up, hidden folders, direct path entry, retry and keyboard dismissal", async () => {
	const { machine, read } = service();
	const select = mock();

	root.render(<Fixture service={machine} select={select} />);
	click("browse");
	await settle();
	expect(root.renderer.getAllText()).toContain("Show hidden folders");
	click("remote-folder-hidden");
	await settle();
	expect(root.renderer.getAllText()).toContain("Hide hidden folders");
	expect(root.renderer.findByTestId("remote-folder-.config")).toBeDefined();
	root.renderer.focusElement(node("remote-folder-projects").id);
	root.renderer.simulateKeystrokes("down");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		node("remote-folder-.config").id
	);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(node("remote-folder-path").customProps?.value).toBe(
		"/home/test/.config"
	);
	click("remote-folder-up");
	await settle();
	read.mockRejectedValueOnce(new Error("Permission denied"));
	enter("remote-folder-path", "/restricted");
	click("remote-folder-select");
	expect(select).not.toHaveBeenCalled();
	click("remote-folder-go");
	await settle();
	expect(root.renderer.getAllText()).toContain("Permission denied");
	click("remote-folder-select");
	expect(select).not.toHaveBeenCalled();
	click("remote-folder-retry");
	await settle();
	expect(node("remote-folder-path").customProps?.value).toBe("/restricted");
	click("remote-folder-home");
	await settle();
	expect(node("remote-folder-path").customProps?.value).toBe("/home/test");
	click("remote-folder-hidden");
	await settle();
	expect(root.renderer.getAllText()).toContain("Show hidden folders");
	expect(root.renderer.findByTestId("remote-folder-.config")).toBeUndefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(root.renderer.findByTestId("remote-folder-picker")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(node("browse").id);
});

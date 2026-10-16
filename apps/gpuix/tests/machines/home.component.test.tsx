/**
 * Covers: saved-machine selection, shared row hover/focus, remote discovery, opening through existing tabs and SSH setup, isolated settings, folder management and keyboard dismissal.
 * Real: App, machine switcher, discovery/session hooks and GPUIX layout/input.
 * Doubles: SSH, credentials, scans and repository reads; no user folders or network.
 * Requires: patched GPUIX renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { appThemes } from "../../src/styles/theme";
import { Machines } from "../../src/feature/machines/machines";
import { windowOptions } from "../../src/window-options";
import type { SavedMachine } from "../../src/feature/machines/machine-store";
import { MachineStore } from "../../src/feature/machines/machine-store";
import { MachineLocation } from "../../src/feature/machines/machine-location";
import { SshConnection } from "../../src/feature/machines/ssh-connection";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

const saved = {
	id: "00000000-0000-4000-8000-000000000001",
	name: "Devbox",
	host: "devbox",
	username: "",
	port: null,
	identityFile: "",
	folders: ["/remote/home/projects"],
} as const;

function click(testId: string): void {
	const node = root.renderer.findByTestId(testId);
	const box = node && root.renderer.getElementBounds(node.id);

	if (!box) throw new Error(`Missing ${testId}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}

async function settle(): Promise<void> {
	for (const _ of [0, 1, 2, 3, 4]) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
}

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});

afterEach(() => {
	root.unmount();
	mock.restore();
});

it("selects one saved machine, scans its folders and opens a discovered repository in the existing workspace", async () => {
	const service = new Machines(new MachineStore("/unused/machines.json"));

	const accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			return null;
		},
		async write() {},
		async delete() {},
	});

	const remotePath = MachineLocation.encode(
		saved.id,
		"/remote/home/projects/remote-repo"
	);

	const connection = new SshConnection(
		saved,
		async () => null,
		() => undefined
	);

	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(service, "list").mockReturnValue([saved]);
	spyOn(service, "home").mockReturnValue("/remote/home");
	spyOn(service, "connect").mockResolvedValue(connection);
	spyOn(service, "state").mockReturnValue({ status: "Connected" });
	const scan = spyOn(service, "scan").mockResolvedValue({
		paths: [remotePath],
		scanned: 3,
		skipped: 0,
		limited: false,
	});

	const read = mock(async (path: string) => {
		const snapshot = repositorySnapshot();

		return {
			ok: true as const,
			value: {
				...snapshot,
				repository: { ...snapshot.repository, root: path },
			},
		};
	});

	root.render(
		<App
			machines={service}
			accounts={accounts}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				recentRepositories: ["/local/repo"],
			}}
			readRepository={read}
			readDiff={async () => ({ ok: true, value: [] })}
		/>
	);
	await settle();
	click(`machine-${saved.id}`);
	await settle();
	expect(root.renderer.findByTestId("machine-edit")).toBeUndefined();
	expect(root.renderer.findByTestId("machine-scan-folder")).toBeUndefined();
	expect(scan).toHaveBeenCalled();
	expect(scan.mock.calls[0]?.[1]).toEqual([
		MachineLocation.encode(saved.id, "/remote/home"),
	]);
	click(
		"welcome-folder-/@1git-ssh/00000000-0000-4000-8000-000000000001/remote/home/projects"
	);
	await settle();
	expect(
		root.renderer.findByTestId(`welcome-repository-${remotePath}`)
	).toBeDefined();
	expect(
		root.renderer.findByTestId("welcome-repository-/local/repo")
	).toBeUndefined();

	if (process.env.GPUIX_MACHINES_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_MACHINES_SCREENSHOT);

	click(`welcome-repository-${remotePath}`);
	await settle();
	expect(read.mock.calls.at(-1)?.[0]).toBe(remotePath);
	expect(
		root.renderer.findByTestId("workspace-1")?.customProps?.["aria-label"]
	).toContain("Devbox");
});

it("provides a single SSH setup form with saved-host suggestions and secure password input", async () => {
	const service = new Machines(new MachineStore("/unused/machines.json"));

	const accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			return null;
		},
		async write() {},
		async delete() {},
	});

	spyOn(service, "list").mockReturnValue([]);
	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(Machines, "aliases").mockResolvedValue(["my-devbox"]);
	root.render(
		<App
			machines={service}
			accounts={accounts}
			initialSession={{ version: 1, tabs: [], activeId: null }}
		/>
	);
	await settle();
	click("machine-add");
	await settle();
	expect(root.renderer.findByTestId("machine-settings")).toBeDefined();
	expect(root.renderer.findByTestId("ssh-alias-my-devbox")).toBeDefined();
	click("machine-advanced");
	expect(root.renderer.findByTestId("machine-password")).toBeDefined();
	expect(root.renderer.findByTestId("machine-connect")).toBeDefined();
});

async function finishDialog(): Promise<void> {
	await Bun.sleep(120);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await settle();
}

function settingsFixture(appearance: "light" | "dark" = "dark") {
	const service = new Machines(new MachineStore("/unused/machines.json"));
	let machines: readonly SavedMachine[] = [saved];

	const accounts = new Accounts(new AccountStore("/unused/accounts.json"), {
		async read() {
			return null;
		},
		async write() {},
		async delete() {},
	});

	const connection = new SshConnection(
		saved,
		async () => null,
		() => undefined
	);

	spyOn(accounts, "load").mockReturnValue([]);
	spyOn(service, "list").mockImplementation(() => machines);
	spyOn(service, "home").mockReturnValue("/remote/home");
	spyOn(service, "connect").mockResolvedValue(connection);
	spyOn(service, "state").mockReturnValue({ status: "Connected" });
	spyOn(Machines, "aliases").mockResolvedValue([]);
	spyOn(service, "scan").mockResolvedValue({
		paths: [
			MachineLocation.encode(saved.id, "/remote/home/projects/remote-repo"),
		],
		scanned: 3,
		skipped: 0,
		limited: true,
	});
	const save = spyOn(service, "save").mockImplementation(async (machine) => {
		machines = [machine];
	});

	const remove = spyOn(service, "remove").mockResolvedValue();

	root.render(
		<App
			machines={service}
			accounts={accounts}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				appearance,
				repositoryLibrary: { machine: saved.id, view: "listed", starred: [] },
			}}
		/>
	);

	return { service, save, remove };
}

for (const appearance of ["light", "dark"] as const) {
	it(`keeps Home compact and contains machine settings in a keyboard-accessible ${appearance} dialog`, async () => {
		settingsFixture(appearance);
		await settle();
		expect(root.renderer.findByTestId("machine-settings")).toBeUndefined();
		expect(root.renderer.findByTestId("machine-edit")).toBeUndefined();
		expect(root.renderer.findByTestId("machine-scan-folder")).toBeUndefined();
		const screenshot = process.env.GPUIX_MACHINES_SETTINGS_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.home.png`);

		click(`machine-manage-${saved.id}`);
		await finishDialog();
		expect(root.renderer.findByTestId("machine-edit")).toBeDefined();
		expect(root.renderer.findByTestId("machine-scan-folder")).toBeDefined();
		const dialog = root.renderer.findByTestId("machine-settings")!;
		const bounds = root.renderer.getElementBounds(dialog.id)!;

		expect(bounds.width).toBe(540);
		expect(bounds.y).toBeGreaterThanOrEqual(12);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(788);

		if (screenshot)
			root.renderer.captureScreenshot(
				`${screenshot}.${appearance}.settings.png`
			);

		root.renderer.simulateKeystrokes("tab");
		root.renderer.flush();
		const focus = root.renderer.getFocusedElementId();

		expect(focus).toBeDefined();
		expect(focus).not.toBe(root.renderer.findByTestId("machine-local")!.id);
		root.renderer.simulateKeystrokes("escape");
		await finishDialog();
		expect(root.renderer.findByTestId("machine-settings")).toBeUndefined();
		expect(root.renderer.getFocusedElementId()).toBe(
			root.renderer.findByTestId(`machine-manage-${saved.id}`)!.id
		);
		click("machine-local");
		await settle();
		expect(root.renderer.findByTestId("open-repository")).toBeDefined();
	});
}

it("saves remote scan folders in settings and requires an explicit confirmation to forget a machine", async () => {
	const { save, remove } = settingsFixture();

	await settle();
	click(`machine-manage-${saved.id}`);
	await finishDialog();
	click("machine-scan-folder");
	root.renderer.simulateKeystrokes([..."/work/projects"].join(" "));
	root.renderer.flush();
	click("machine-add-folder");
	await settle();
	expect(save).toHaveBeenCalledWith({
		...saved,
		folders: [...saved.folders, "/work/projects"],
	});
	expect(
		root.renderer.findByTestId("machine-remove-folder-/work/projects")
	).toBeDefined();
	click("machine-remove-folder-/work/projects");
	await settle();
	expect(save.mock.calls.at(-1)?.[0].folders).toEqual(saved.folders);
	click("machine-forget");
	expect(remove).not.toHaveBeenCalled();
	click("machine-cancel");
	expect(remove).not.toHaveBeenCalled();
	click("machine-forget");
	click("machine-forget");
	await finishDialog();
	expect(remove).toHaveBeenCalledWith(saved.id);
	expect(root.renderer.findByTestId("machine-settings")).toBeUndefined();
});

it("clears a dismissed password draft and scrolls advanced setup at the minimum window size", async () => {
	root.unmount();
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	const { save } = settingsFixture();

	await settle();
	click("machine-add");
	await finishDialog();
	click("machine-advanced");
	await finishDialog();
	const dialog = root.renderer.findByTestId("machine-settings")!;
	const password = root.renderer.findByTestId("machine-password")!;
	const viewport = root.renderer.getElementBounds(dialog.id)!;
	const input = root.renderer.getElementBounds(password.id)!;

	expect(viewport.y + viewport.height).toBeLessThanOrEqual(628);
	root.renderer.scrollTo(dialog.id, 0, -(input.y - viewport.y) + 40);
	await finishDialog();
	click("machine-password");
	root.renderer.simulateKeystrokes("s e c r e t");
	root.renderer.flush();
	expect(
		root.renderer.findByTestId("machine-password")!.customProps?.value
	).toBe("secret");
	root.renderer.simulateKeystrokes("escape");
	await finishDialog();
	click("machine-add");
	await finishDialog();
	click("machine-advanced");
	await finishDialog();
	expect(
		root.renderer.findByTestId("machine-password")!.customProps?.value
	).toBe("");
	expect(save).not.toHaveBeenCalled();
	const screenshot = process.env.GPUIX_MACHINES_SETTINGS_SCREENSHOT;

	if (screenshot)
		root.renderer.captureScreenshot(`${screenshot}.minimum.setup.png`);
});

it("preserves saved machine details when editing and keeps a failed save available for retry", async () => {
	const { save } = settingsFixture();

	await settle();
	click(`machine-manage-${saved.id}`);
	await finishDialog();
	click("machine-edit");
	await finishDialog();
	expect(root.renderer.findByTestId("machine-host")!.customProps?.value).toBe(
		saved.host
	);
	click("machine-host");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([..."devbox-new"].join(" "));
	root.renderer.flush();
	save.mockRejectedValueOnce(new Error("Could not save machine settings."));
	click("machine-connect");
	await settle();
	expect(root.renderer.findByTestId("machine-connection-form")).toBeDefined();
	expect(root.renderer.getAllText()).toContain(
		"Could not save machine settings."
	);
	click("machine-connect");
	await finishDialog();
	expect(save.mock.calls.at(-1)).toEqual([
		{ ...saved, host: "devbox-new" },
		"",
	]);
	expect(root.renderer.findByTestId("machine-connection-form")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("devbox-new");
});

it("keeps settings open until a folder save finishes", async () => {
	const { save } = settingsFixture();
	let complete!: () => void;

	save.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			complete = resolve;
		});
	});
	await settle();
	click(`machine-manage-${saved.id}`);
	await finishDialog();
	click("machine-scan-folder");
	root.renderer.simulateKeystrokes([..."/work/projects"].join(" "));
	root.renderer.flush();
	click("machine-add-folder");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	click("machine-settings-close");
	await finishDialog();
	expect(root.renderer.findByTestId("machine-settings")).toBeDefined();
	complete();
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await finishDialog();
	expect(root.renderer.findByTestId("machine-settings")).toBeUndefined();
});

for (const appearance of ["light", "dark"] as const) {
	it(`highlights the complete ${appearance} machine row across its independent controls`, async () => {
		const { service } = settingsFixture(appearance);

		await settle();
		click("machine-local");
		await settle();
		const connect = spyOn(service, "connect").mockClear();
		const row = () => root.renderer.findByTestId(`machine-row-${saved.id}`)!;
		const open = root.renderer.findByTestId(`machine-${saved.id}`)!;
		const manage = root.renderer.findByTestId(`machine-manage-${saved.id}`)!;
		const openBounds = root.renderer.getElementBounds(open.id)!;
		const manageBounds = root.renderer.getElementBounds(manage.id)!;
		const rowBounds = root.renderer.getElementBounds(row().id)!;

		expect(row().style.backgroundColor).toBe("transparent");
		expect(open.style.hover).toMatchObject({ backgroundColor: "transparent" });
		expect(manageBounds.x + manageBounds.width).toBeLessThanOrEqual(
			rowBounds.x + rowBounds.width
		);

		for (const [x, y] of [
			[openBounds.x + 20, openBounds.y + 20],
			[
				manageBounds.x + manageBounds.width / 2,
				manageBounds.y + manageBounds.height / 2,
			],
			[rowBounds.x + rowBounds.width - 1, rowBounds.y + rowBounds.height / 2],
			[openBounds.x + 30, openBounds.y + 20],
		] as const) {
			root.renderer.nativeSimulateMouseMove(x, y);
			root.renderer.flush();
			expect(row().style.backgroundColor).toBe(
				appThemes[appearance].tokens.colors.surface
			);
		}

		const screenshot = process.env.GPUIX_MACHINE_HOVER_SCREENSHOT;

		if (screenshot)
			root.renderer.captureScreenshot(`${screenshot}.${appearance}.png`);

		root.renderer.nativeSimulateMouseMove(5, 5);
		root.renderer.flush();
		expect(row().style.backgroundColor).toBe("transparent");
		flushSync(() =>
			handleGpuixEvent(
				{ elementId: open.id, eventType: "focus" },
				root.renderer
			)
		);
		expect(row().style.backgroundColor).toBe(
			appThemes[appearance].tokens.colors.surface
		);
		flushSync(() => {
			handleGpuixEvent(
				{ elementId: manage.id, eventType: "focus" },
				root.renderer
			);
			handleGpuixEvent(
				{ elementId: open.id, eventType: "blur" },
				root.renderer
			);
		});
		expect(row().style.backgroundColor).toBe(
			appThemes[appearance].tokens.colors.surface
		);
		flushSync(() =>
			handleGpuixEvent(
				{ elementId: manage.id, eventType: "blur" },
				root.renderer
			)
		);
		expect(row().style.backgroundColor).toBe("transparent");
		click(`machine-manage-${saved.id}`);
		await finishDialog();
		expect(root.renderer.findByTestId("machine-settings")).toBeDefined();
		expect(connect).not.toHaveBeenCalled();
		expect(root.renderer.findByTestId("open-repository")).toBeDefined();
		click("machine-done");
		await finishDialog();
		click(`machine-${saved.id}`);
		await settle();
		root.renderer.nativeSimulateMouseMove(5, 5);
		root.renderer.flush();
		expect(row().style.backgroundColor).toBe(
			appThemes[appearance].tokens.colors.surface
		);
		expect(connect).toHaveBeenCalled();
	});
}

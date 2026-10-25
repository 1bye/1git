/**
 * Covers: space creation, rail/menu/swipe navigation, isolated repository opening, draft restoration and restart.
 * Real: App, space/session models, shared controls and native layout/keyboard events.
 * Doubles: account catalog, repository reads, native menu/picker tracking, trackpad phase boundaries and session writes; no user data or network.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { basename } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent, type EventPayload } from "@gpuix/react";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { NativeFileMenu } from "../../src/feature/repository-workspace/lib/native-file-menu";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { SpaceManager } from "../../src/feature/spaces/space-manager";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { windowOptions } from "../../src/window-options";
import { WorkspaceRail } from "../../src/feature/repository-workspace/components/workspace-rail";

let root: TestRoot;
let accounts: Accounts;
const snapshot = repositorySnapshot([]);

const read = mock(async (path: string) => ({
	ok: true as const,
	value: {
		...snapshot,
		repository: { ...snapshot.repository, root: path, name: basename(path) },
	},
}));

const scan = mock(async () => ({
	paths: ["/test/unassigned"],
	scanned: 1,
	skipped: 0,
	limited: false,
}));

const save = mock<(document: WorkspaceSessionDocument) => void>();

const node = (id: string) => {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
};

const bounds = (id: string) => root.renderer.getElementBounds(node(id).id)!;

function click(id: string) {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}
function enter(id: string, text: string) {
	click(id);
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes(
		[...text]
			.map((character) => (character === " " ? "space" : character))
			.join(" ")
	);
	root.renderer.flush();
}
async function settle() {
	await Bun.sleep(230);
	root.renderer.clockFastForward(250);
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}
function latest() {
	const document = save.mock.calls.at(-1)?.[0];

	if (!document) throw new Error("Session not saved");

	return WorkspaceSession.parse(JSON.stringify(document));
}

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	accounts = new Accounts(new AccountStore("/unused/spaces-accounts.json"), {
		async read() {
			return null;
		},
		async write() {},
		async delete() {},
	});
	spyOn(accounts, "load").mockReturnValue([]);
	read.mockClear();
	scan.mockClear();
	save.mockClear();
});
afterEach(() => {
	root.unmount();
	mock.restore();
});

for (const appearance of ["light", "dark"] as const) {
	it(`creates an icon space above Settings and restores separate tabs/drafts after a ${appearance} restart`, async () => {
		root.render(
			<App
				accounts={accounts}
				readRepository={read}
				discoverRepositories={scan}
				saveSession={save}
				initialSession={{
					version: 1,
					tabs: [
						{ id: "workspace-1", path: "/test/work", draft: "Work draft" },
					],
					activeId: "workspace-1",
					recentRepositories: ["/test/work", "/test/personal"],
					appearance,
				}}
			/>
		);
		await settle();
		expect(root.renderer.findByTestId("rail-spaces")).toBeUndefined();
		click("workspace-home");
		await settle();
		expect(scan).toHaveBeenCalled();
		click("workspace-1");
		await settle();
		root.renderer.simulateKeystrokes("cmd-,");
		await settle();
		click("settings-spaces");
		click("space-create");
		await settle();
		enter("space-name", "Personal");
		click("space-icon-rocket");
		expect(root.renderer.findByTestId("space-emoji")).toBeUndefined();
		expect(
			root.renderer.findByTestId("space-repository-search")
		).toBeUndefined();
		expect(root.renderer.findByTestId("space-repositories")).toBeUndefined();
		const editor = bounds("space-editor");

		expect(editor.y).toBeGreaterThanOrEqual(12);
		expect(editor.y + editor.height).toBeLessThanOrEqual(628);

		if (process.env.GPUIX_SPACES_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_SPACES_SCREENSHOT}.${appearance}.png`
			);

		click("space-editor-save");
		await settle();
		expect(root.renderer.findByTestId("space-editor")).toBeUndefined();
		expect(node("rail-spaces").customProps?.["aria-label"]).toBe(
			"Spaces: Personal"
		);
		expect(
			bounds("rail-settings").y -
				bounds("rail-spaces").y -
				bounds("rail-spaces").height
		).toBe(4);
		expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
		const personalId = latest().activeSpaceId!;

		root.renderer.simulateKeystrokes("cmd-p");
		await settle();
		expect(
			root.renderer.findByTestId("quick-repository-/test/work")
		).toBeUndefined();
		expect(
			root.renderer.findByTestId("quick-repository-/test/unassigned")
		).toBeUndefined();
		expect(
			root.renderer.findByTestId("quick-repository-/test/personal")
		).toBeUndefined();
		root.renderer.simulateKeystrokes("escape");
		await settle();
		const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([
			"/test/personal",
		]);

		click("open-repository");
		await settle();
		expect(picker).toHaveBeenCalledTimes(1);
		expect(node("commit-message").customProps?.value).toBe("");
		enter("commit-message", "Personal draft");
		await settle();
		const menu = spyOn(NativeFileMenu, "showItems").mockReturnValue({
			kind: "select",
			id: "default",
		});

		click("rail-spaces");
		await settle();
		expect(menu).toHaveBeenCalled();
		expect(node("commit-message").customProps?.value).toBe("Work draft");
		menu.mockReturnValue({ kind: "select", id: personalId });
		click("rail-spaces");
		await settle();
		expect(node("commit-message").customProps?.value).toBe("Personal draft");
		const document = latest();

		expect(
			document.spaces?.find((space) => space.id === personalId)
		).toMatchObject({ icon: "rocket", repositories: ["/test/personal"] });
		root.unmount();
		root = createTestRoot({
			width: 980,
			height: 640,
			onKeyDown: windowOptions.onKeyDown,
		});
		root.renderer.clockPause();
		root.render(
			<App
				accounts={accounts}
				readRepository={read}
				discoverRepositories={scan}
				saveSession={save}
				initialSession={document}
			/>
		);
		await settle();
		expect(node("rail-spaces").customProps?.["aria-label"]).toBe(
			"Spaces: Personal"
		);
		expect(node("commit-message").customProps?.value).toBe("Personal draft");
	}, 15000);
}

it("validates the name and cancels icon edits without saving", async () => {
	const saved = mock();
	const close = mock();

	root.render(<SpaceManager onSave={saved} onClose={close} />);
	await settle();
	click("space-editor-save");
	expect(root.renderer.getAllText()).toContain(
		"Enter a space name, up to 60 characters."
	);
	enter("space-name", "Work");
	click("space-icon-shield");
	click("space-editor-cancel");
	expect(close).toHaveBeenCalledTimes(1);
	expect(saved).not.toHaveBeenCalled();
});

const spaceIds = [
	"default",
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
];

function showSwipeSpaces(count = 3): void {
	root.render(
		<App
			accounts={accounts}
			readRepository={read}
			discoverRepositories={scan}
			saveSession={save}
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				activeSpaceId: "default",
				spaces: spaceIds.slice(0, count).map((id, index) => ({
					id,
					name: ["Default", "Work", "Personal"][index] ?? id,
					icon: "layers",
					activeId: `workspace-${index + 1}`,
					repositories: [`/test/space-${index}`],
					discovery: { folders: [], hidden: [] },
					library: { starred: [], view: "tiles" },
				})),
				tabs: spaceIds.slice(0, count).map((spaceId, index) => ({
					id: `workspace-${index + 1}`,
					spaceId,
					path: `/test/space-${index}`,
					draft: `Draft ${index}`,
				})),
			}}
		/>
	);
}

function railPhase(phase: string, extra: Partial<EventPayload> = {}): void {
	flushSync(() =>
		handleGpuixEvent(
			{
				elementId: node("workspace-rail").id,
				eventType: "scroll",
				precise: true,
				touchPhase: phase,
				deltaX: 0,
				deltaY: 0,
				...extra,
			},
			root.renderer
		)
	);
}

function railMove(
	deltaX: number,
	deltaY = 0,
	target = "rail-window-drag-region"
): void {
	const box = bounds(target);

	root.renderer.nativeSimulateScrollWheel(
		box.x + box.width / 2,
		box.y + box.height / 2,
		deltaX,
		deltaY
	);
	root.renderer.flush();
}

it("switches spaces with a horizontal rail gesture once, preserving every draft and ignoring inertia", async () => {
	showSwipeSpaces();
	await settle();
	railPhase("started");
	railMove(-25);
	expect(node("commit-message").customProps?.value).toBe("Draft 0");
	railMove(-30);
	await settle();
	expect(node("rail-spaces").customProps?.["aria-label"]).toBe("Spaces: Work");
	expect(node("commit-message").customProps?.value).toBe("Draft 1");
	railMove(-200);
	railPhase("ended");
	railMove(-200);
	await settle();
	expect(latest().activeSpaceId).toBe(spaceIds[1]);
	railPhase("started");
	railMove(-60, 0, "view-changes");
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Draft 2");
	railPhase("ended");
	railPhase("started");
	railMove(-100);
	await settle();
	expect(latest().activeSpaceId).toBe(spaceIds[2]);
	railPhase("ended");
	railPhase("started");
	railMove(60);
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Draft 1");
	expect(latest().tabs.map((tab) => tab.draft)).toEqual([
		"Draft 0",
		"Draft 1",
		"Draft 2",
	]);
});

it("ignores vertical gestures, mouse-wheel ticks, modified scrolling and content scrolling", async () => {
	showSwipeSpaces();
	await settle();
	railPhase("started");
	railMove(0, -100);
	railMove(-100);
	railPhase("ended");
	railPhase("started", { precise: false, deltaX: -100 });
	railPhase("ended");
	railPhase("started", {
		deltaX: -100,
		modifiers: { cmd: true, ctrl: false, alt: false, shift: false },
	});
	railPhase("ended");
	const content = bounds("workspace");
	const rail = bounds("rail-window-drag-region");

	root.renderer.nativeSimulateMouseMove(
		rail.x + rail.width / 2,
		rail.y + rail.height / 2
	);
	root.renderer.flush();
	railPhase("started", { deltaX: -25 });
	root.renderer.nativeSimulateMouseMove(
		content.x + content.width / 2,
		content.y + content.height / 2
	);
	root.renderer.flush();
	railMove(-100);

	root.renderer.nativeSimulateScrollWheel(
		content.x + content.width / 2,
		content.y + content.height / 2,
		-150,
		0
	);
	root.renderer.flush();
	await settle();
	expect(latest().activeSpaceId).toBe("default");
	expect(node("commit-message").customProps?.value).toBe("Draft 0");
});

it("uses the Settings rail and cannot switch twice when it returns to a workspace", async () => {
	showSwipeSpaces();
	await settle();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeDefined();
	railPhase("started");
	railMove(-60);
	await settle();
	expect(root.renderer.findByTestId("settings-view")).toBeUndefined();
	expect(node("rail-spaces").customProps?.["aria-label"]).toBe("Spaces: Work");
	railMove(-200);
	await settle();
	expect(latest().activeSpaceId).toBe(spaceIds[1]);
});

it("does not switch with one space or a disabled rail", async () => {
	showSwipeSpaces(1);
	await settle();
	railPhase("started");
	railMove(-100);
	await settle();
	expect(node("commit-message").customProps?.value).toBe("Draft 0");
	const onSwipe = mock();

	const showRail = (disabled: boolean) =>
		root.render(
			<div style={{ height: "100%" }}>
				<WorkspaceRail
					accounts={accounts}
					disabled={disabled}
					onSettings={() => {}}
					onAddAccount={() => {}}
					onSpaceSwipe={onSwipe}
				/>
			</div>
		);

	showRail(false);
	railPhase("started", { deltaX: -25 });
	showRail(true);
	await settle();
	showRail(false);
	railMove(-100);
	expect(onSwipe).not.toHaveBeenCalled();
	railPhase("started");
	railMove(-60);
	expect(onSwipe).toHaveBeenCalledWith("next");
});

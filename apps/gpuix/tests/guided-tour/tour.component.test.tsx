/**
 * Covers: real-control tour progression, keyboard dismissal, pause/replay, deferred swipes and session migration.
 * Real: App, native rendering/events, reducers and session persistence.
 * Doubles: Git reads, discovery, Git settings, account credentials and metadata in a disposable directory.
 * Requires: patched GPUIX renderer and macOS graphics; no network or Git writes.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { hostingRepositories } from "../_shared/hosting-repositories";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import type { WorkspaceSessionDocument } from "../../src/feature/workspace-tabs/lib/workspace-session";
import type { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import type { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import { tourSteps } from "../../src/feature/guided-tour/guided-tour";

let root: TestRoot;
let accounts: ReturnType<typeof hostingRepositories>;

beforeEach(() => {
	accounts = hostingRepositories();
	spyOn(accounts.accounts, "cliAccounts").mockResolvedValue([]);
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
	rmSync(accounts.directory, { recursive: true, force: true });
});

const node = (id: string) => {
	const found = root.renderer.findByTestId(id);

	if (!found) throw new Error(`Missing ${id}`);

	return found;
};

async function settle() {
	for (let index = 0; index < 5; index++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
}
function advance(ms = 700) {
	root.renderer.clockFastForward(ms);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}
async function click(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id)!;

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
	advance(250);
	await settle();
}
function fixture() {
	const readRepository = mock<typeof RepositoryReader.read>(async () => ({
		ok: true,
		value: repositorySnapshot(),
	}));

	const readBranches = mock<typeof RepositoryBranches.read>(async () => ({
		ok: true,
		value: {
			branches: { current: "main", branches: [] },
			savedChanges: [],
			remotes: [],
			worktrees: [],
		},
	}));

	const saveSession = mock<(document: WorkspaceSessionDocument) => void>(
		() => {}
	);

	return {
		accounts: accounts.accounts,
		readRepository,
		readBranches,
		saveSession,
		discoverRepositories: async () => ({
			paths: [],
			scanned: 0,
			skipped: 0,
			limited: false,
		}),
		readGitSettings: async () => ({
			ok: true as const,
			value: {
				identity: { name: "Author", email: "author@example.test" },
				custom: true,
				remotes: [],
			},
		}),
	};
}
function session(spaceCount = 2): WorkspaceSessionDocument {
	return {
		version: 1,
		onboarding: "complete",
		tips: { completed: [] },
		smoothTransitions: false,
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
		activeId: "workspace-1",
		activeSpaceId: "default",
		spaces: ["default", "00000000-0000-4000-8000-000000000001"]
			.slice(0, spaceCount)
			.map((id, index) => ({
				id,
				name: index === 0 ? "Default" : "Work",
				icon: index === 0 ? "layers" : "work",
				activeId: index === 0 ? "workspace-1" : null,
				repositories: [],
				discovery: { folders: [], hidden: [] },
				library: { starred: [], view: "tiles" },
			})),
	};
}
async function start(props = fixture(), document = session()) {
	root.render(<App {...props} initialSession={document} />);
	await settle();
	advance();
	await settle();

	return props;
}
async function closeMenu() {
	const bounds = root.renderer.getElementBounds(node("workspace-1").id)!;

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width + 320,
		bounds.y + 250
	);
	await settle();
}
function swipe(deltaX = -70) {
	const rail = node("workspace-rail");

	const phase = (touchPhase: string) =>
		flushSync(() =>
			handleGpuixEvent(
				{
					elementId: rail.id,
					eventType: "scroll",
					precise: true,
					touchPhase,
					deltaX: 0,
					deltaY: 0,
				},
				root.renderer
			)
		);

	const bounds = root.renderer.getElementBounds(node("rail-spaces").id)!;

	phase("started");
	root.renderer.nativeSimulateScrollWheel(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
		deltaX,
		0
	);
	phase("ended");
}

it.each(["light", "dark"] as const)(
	"teaches real tabs, worktrees and a rail swipe in %s appearance",
	async (appearance) => {
		const props = fixture();

		root.render(
			<App {...props} initialSession={{ ...session(), appearance }} />
		);
		await settle();
		expect(root.renderer.findByTestId("tour-step-tab-menu")).toBeUndefined();
		advance();
		await settle();
		expect(node("tour-step-tab-menu")).toBeDefined();
		const tab = root.renderer.getElementBounds(node("workspace-1").id)!;

		const ring = root.renderer.getElementBounds(node("tour-target-ring").id)!;

		expect(ring.x).toBeLessThanOrEqual(tab.x);
		expect(ring.x + ring.width).toBeGreaterThanOrEqual(tab.x + tab.width);

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-tour-tabs.png`
			);

		await click("workspace-1");
		expect(node("workspace-menu")).toBeDefined();
		expect(node("tour-step-worktrees")).toBeDefined();
		await Bun.sleep(40);
		await settle();
		const worktrees = root.renderer.getElementBounds(node("worktrees").id)!;

		const worktreesRing = root.renderer.getElementBounds(
			node("tour-target-ring").id
		)!;

		expect(worktreesRing.y).toBeCloseTo(worktrees.y - 3);

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-tour-worktrees.png`
			);

		await click("worktrees");
		expect(node("workspace-worktrees")).toBeDefined();
		expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
		await closeMenu();
		expect(node("tour-step-space-swipe")).toBeDefined();

		if (process.env.GPUIX_ONBOARDING_SCREENSHOT)
			root.renderer.captureScreenshot(
				`${process.env.GPUIX_ONBOARDING_SCREENSHOT}-${appearance}-tour-swipe.png`
			);

		swipe();
		await settle();
		expect(node("tour-confirmation")).toBeDefined();
		expect(root.renderer.findByTestId("tour-step-space-swipe")).toBeUndefined();
		advance(3100);
		await settle();
		expect(root.renderer.findByTestId("tour-confirmation")).toBeUndefined();
		root.render(<div />);
		expect(props.saveSession.mock.calls.at(-1)?.[0].tips).toEqual({
			completed: tourSteps,
		});
	}
);

it("skips and persists every remaining tip, including across remounts", async () => {
	const props = await start();

	await click("tour-skip");
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	root.render(<div />);
	const saved = props.saveSession.mock.calls.at(-1)?.[0];

	expect(saved?.tips).toEqual({ completed: tourSteps, dismissed: true });
	await start(props, saved);
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
});

it.each(["enter", "space"])(
	"opens tabs with %s and Escape skips without stealing focus",
	async (key) => {
		await start();
		root.renderer.focusElement(node("workspace-1").id);
		root.renderer.nativeSimulateKeyDown(node("workspace-1").id, key);

		if (key === "space")
			root.renderer.nativeSimulateKeyUp(node("workspace-1").id, key);

		await settle();
		advance(250);
		await settle();
		expect(node("tour-step-worktrees")).toBeDefined();
		root.renderer.simulateKeystrokes("escape");
		await settle();
		expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	}
);

it("pauses for Settings and replays from Appearance", async () => {
	const props = await start();

	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(node("tour-step-tab-menu")).toBeDefined();
	await click("tour-skip");
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	await click("settings-appearance");
	root.renderer.scrollIntoView(node("settings-replay-tips").id);
	root.renderer.advanceTime(1);
	await settle();
	await click("settings-replay-tips");
	expect(node("tour-step-tab-menu")).toBeDefined();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].tips).toEqual({
		completed: [],
	});
});

it("backfills existing completed sessions without automatically showing the tour", async () => {
	const document = { ...session(), tips: undefined };
	const props = await start(fixture(), document);

	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].tips).toEqual({
		completed: tourSteps,
	});
});

it("finishes onboarding before starting the tour for a new session", async () => {
	const props = fixture();

	root.render(
		<App
			{...props}
			initialSession={{
				...session(),
				onboarding: "repository",
				tips: undefined,
			}}
		/>
	);
	await settle();
	advance();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	await click("onboarding-next");
	await settle();
	expect(node("tour-step-tab-menu")).toBeDefined();
});

it("defers the swipe with one space and teaches it alone after creating a second", async () => {
	const props = await start(fixture(), session(1));

	expect(root.renderer.getAllText()).toContain("1 of 2");
	await click("workspace-1");
	expect(node("tour-step-worktrees")).toBeDefined();
	await closeMenu();
	expect(node("tour-confirmation")).toBeDefined();
	advance(3100);
	await settle();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	await click("settings-spaces");
	await click("space-create");
	root.renderer.focusElement(node("space-name").id);
	root.renderer.simulateKeystrokes("W o r k");
	await settle();
	await click("space-editor-save");
	await settle();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(node("tour-step-space-swipe")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("1 of 1");
	swipe(70);
	await settle();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].tips?.completed).toEqual(
		tourSteps
	);
});

it("resumes a saved worktrees step without silently completing it on mount", async () => {
	const props = await start(fixture(), {
		...session(),
		tips: { completed: ["tab-menu"] },
	});

	expect(node("tour-step-worktrees")).toBeDefined();
	root.render(<div />);
	expect(props.saveSession.mock.calls.at(-1)?.[0].tips?.completed).toEqual([
		"tab-menu",
	]);
});

it("keeps the worktrees target clickable at the minimum window size", async () => {
	root.unmount();
	root = createTestRoot({
		width: 640,
		height: 420,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	await start();
	await click("workspace-1");
	await Bun.sleep(40);
	await settle();
	const trigger = root.renderer.getElementBounds(node("worktrees").id)!;
	const coach = root.renderer.getElementBounds(node("tour-coach-mark").id)!;

	expect(
		coach.x >= trigger.x + trigger.width ||
			coach.x + coach.width <= trigger.x ||
			coach.y >= trigger.y + trigger.height ||
			coach.y + coach.height <= trigger.y
	).toBe(true);
	expect(coach.x + coach.width).toBeLessThanOrEqual(640);
	expect(coach.y + coach.height).toBeLessThanOrEqual(420);
	await click("worktrees");
	expect(node("workspace-worktrees")).toBeDefined();
});

it("pauses for a nested workspace popover until its exit has finished", async () => {
	const props = fixture();
	const document = session();

	const render = (open: boolean) =>
		root.render(
			<div style={{ width: "100%", height: "100%" }}>
				<App {...props} initialSession={document} />
				<Popover open={open} onOpenChange={() => {}}>
					<PopoverContent
						aria-label="Workspace confirmation"
						placement="center"
					>
						<text>Confirm action</text>
					</PopoverContent>
				</Popover>
			</div>
		);

	render(false);
	await settle();
	advance();
	await settle();
	expect(node("tour-step-tab-menu")).toBeDefined();
	render(true);
	await settle();
	advance(250);
	await settle();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	render(false);
	await settle();
	expect(root.renderer.findByTestId("tour-coach-mark")).toBeUndefined();
	advance(300);
	root.renderer.advanceTime(1);
	await Bun.sleep(120);
	await settle();
	expect(node("tour-step-tab-menu")).toBeDefined();
});

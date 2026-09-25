import { describe, expect, test } from "bun:test";

import type { ComponentProps, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkspaceTabState } from "../src/renderer/src/feature/workspace/types/git-workspace.js";
import {
	WorkspaceTabTrigger,
	WorkspaceTabTriggerElement,
} from "../src/renderer/src/fixture/desktop-toolbar/components/workspace-tab.js";
import { LiquidMenuTrigger } from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu.js";

type LiquidTriggerProps = ComponentProps<typeof LiquidMenuTrigger>;
type LiquidTriggerClick = NonNullable<LiquidTriggerProps["onClick"]>;
type LiquidTriggerKeyDown = NonNullable<LiquidTriggerProps["onKeyDown"]>;

const WORKSPACE: WorkspaceTabState = {
	branch: "main",
	changedFiles: 0,
	owner: null,
	session: {
		id: "workspace-session",
		lastActivatedAt: "2026-08-09T10:00:00.000Z",
		openedAt: "2026-08-09T10:00:00.000Z",
		repository: {
			commonDirectory: "/repos/example/.git",
			gitDirectory: "/repos/example/.git",
			isBare: false,
			isShallow: false,
			root: "/repos/example",
		},
	},
};

interface TriggerFixture {
	readonly click: LiquidTriggerClick;
	readonly element: ReactElement;
	readonly getActivationCount: () => number;
	readonly getOpenCount: () => number;
	readonly keyDown: LiquidTriggerKeyDown;
	readonly props: LiquidTriggerProps;
}

const createTriggerFixture = (
	isActive: boolean,
	isDragging = false,
	isDisabled = false
): TriggerFixture => {
	let activationCount = 0;
	let openCount = 0;
	const element = WorkspaceTabTrigger({
		activate: (): Promise<void> => {
			activationCount += 1;
			return Promise.resolve();
		},
		isActive,
		isDisabled,
		isDragging,
		isOverlay: false,
		label: "example / main",
		onOpenActions: (): void => {
			openCount += 1;
		},
		repositoryName: "example",
		workspace: WORKSPACE,
	});
	const props = element.props as LiquidTriggerProps;
	if (!(props.onClick && props.onKeyDown)) {
		throw new Error("Expected the workspace liquid trigger handlers.");
	}
	return {
		click: props.onClick,
		element,
		getActivationCount: () => activationCount,
		getOpenCount: () => openCount,
		keyDown: props.onKeyDown,
		props,
	};
};

const createClickEvent = (
	defaultPrevented = false,
	target: EventTarget | null = null
): {
	readonly event: Parameters<LiquidTriggerClick>[0];
	readonly wasBaseHandlerPrevented: () => boolean;
} => {
	let baseHandlerPrevented = false;
	return {
		event: {
			defaultPrevented,
			preventBaseUIHandler: (): void => {
				baseHandlerPrevented = true;
			},
			target,
		} as Parameters<LiquidTriggerClick>[0],
		wasBaseHandlerPrevented: () => baseHandlerPrevented,
	};
};

const createKeyDownEvent = (): {
	readonly event: Parameters<LiquidTriggerKeyDown>[0];
	readonly wasBaseHandlerPrevented: () => boolean;
} => {
	let baseHandlerPrevented = false;
	return {
		event: {
			preventBaseUIHandler: (): void => {
				baseHandlerPrevented = true;
			},
		} as Parameters<LiquidTriggerKeyDown>[0],
		wasBaseHandlerPrevented: () => baseHandlerPrevented,
	};
};

describe("workspace tab trigger", () => {
	test("keeps inactive tabs as selected workspace controls without popup semantics", () => {
		const markup = renderToStaticMarkup(
			<WorkspaceTabTriggerElement
				aria-controls="workspace-menu"
				aria-expanded
				aria-haspopup="menu"
				aria-selected={false}
				isActive={false}
				isMenuOpen={false}
				role="tab"
			>
				Example
			</WorkspaceTabTriggerElement>
		);

		expect(markup).toContain('role="tab"');
		expect(markup).toContain('aria-controls="repository-workspace"');
		expect(markup).toContain('aria-selected="false"');
		expect(markup).not.toContain("workspace-menu");
		expect(markup).not.toContain("aria-expanded");
		expect(markup).not.toContain("aria-haspopup");
	});

	test("exposes active popup semantics without replacing the trigger type", () => {
		const inactive = createTriggerFixture(false);
		const active = createTriggerFixture(true);
		const inactiveRender = inactive.props.render;
		const activeRender = active.props.render;
		if (
			typeof inactiveRender !== "function" ||
			typeof activeRender !== "function"
		) {
			throw new Error("Expected stable workspace trigger render callbacks.");
		}
		const inactiveTriggerElement = inactiveRender(
			{},
			{ disabled: false, open: false }
		);
		const activeTriggerElement = activeRender(
			{},
			{ disabled: false, open: false }
		);
		const closedMarkup = renderToStaticMarkup(
			<WorkspaceTabTriggerElement
				aria-controls="workspace-menu"
				aria-haspopup="menu"
				aria-selected
				isActive
				isMenuOpen={false}
				role="tab"
			/>
		);
		const openMarkup = renderToStaticMarkup(
			<WorkspaceTabTriggerElement
				aria-controls="workspace-menu"
				aria-haspopup="menu"
				aria-selected
				isActive
				isMenuOpen
				role="tab"
			/>
		);

		expect(inactive.element.type).toBe(LiquidMenuTrigger);
		expect(active.element.type).toBe(LiquidMenuTrigger);
		expect(inactiveTriggerElement.type).toBe(WorkspaceTabTriggerElement);
		expect(activeTriggerElement.type).toBe(WorkspaceTabTriggerElement);
		expect(closedMarkup).toContain('role="tab"');
		expect(closedMarkup).toContain('aria-selected="true"');
		expect(closedMarkup).toContain('aria-controls="repository-workspace"');
		expect(closedMarkup).not.toContain("workspace-menu");
		expect(closedMarkup).toContain('aria-expanded="false"');
		expect(closedMarkup).toContain('aria-haspopup="menu"');
		expect(openMarkup).toContain('aria-expanded="true"');
	});

	test("activates an inactive tab and keeps keyboard popup handling suppressed", async () => {
		const fixture = createTriggerFixture(false);
		const clickEvent = createClickEvent();
		const keyDownEvent = createKeyDownEvent();

		await fixture.click(clickEvent.event);
		fixture.keyDown(keyDownEvent.event);

		expect(fixture.getActivationCount()).toBe(1);
		expect(fixture.getOpenCount()).toBe(0);
		expect(clickEvent.wasBaseHandlerPrevented()).toBe(true);
		expect(keyDownEvent.wasBaseHandlerPrevented()).toBe(true);
		expect(fixture.props.role).toBe("tab");
		expect(fixture.props["aria-selected"]).toBe(false);
		expect(fixture.props.tabIndex).toBe(-1);
	});

	test("opens active actions from the shared avatar and name hit target", async () => {
		const fixture = createTriggerFixture(true);
		const avatarClick = createClickEvent(false, new EventTarget());
		const nameClick = createClickEvent(false, new EventTarget());
		const keyDownEvent = createKeyDownEvent();

		await fixture.click(avatarClick.event);
		await fixture.click(nameClick.event);
		fixture.keyDown(keyDownEvent.event);

		expect(fixture.getActivationCount()).toBe(0);
		expect(fixture.getOpenCount()).toBe(2);
		expect(avatarClick.wasBaseHandlerPrevented()).toBe(true);
		expect(nameClick.wasBaseHandlerPrevented()).toBe(true);
		expect(keyDownEvent.wasBaseHandlerPrevented()).toBe(false);
		expect(fixture.props.tabIndex).toBe(0);
	});

	test("ignores both canceled clicks and clicks while dragging", async () => {
		const canceledFixture = createTriggerFixture(true);
		const draggingFixture = createTriggerFixture(false, true);

		await canceledFixture.click(createClickEvent(true).event);
		await draggingFixture.click(createClickEvent().event);

		expect(canceledFixture.getOpenCount()).toBe(0);
		expect(draggingFixture.getActivationCount()).toBe(0);
	});

	test("blocks busy workspace tabs without fading their contents", () => {
		const fixture = createTriggerFixture(false, false, true);

		expect(fixture.props.disabled).toBe(true);
		expect(fixture.props.className).toContain("disabled:pointer-events-none");
		expect(fixture.props.className).not.toContain("disabled:opacity");
	});
});

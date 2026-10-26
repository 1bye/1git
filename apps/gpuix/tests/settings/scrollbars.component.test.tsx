/**
 * Covers: page/editor/sidebar scrollbars, pinned actions, forwarded scroll refs and the pane-scrollbar preference.
 * Real: shared Settings layouts, native scroll handles and keyboard input.
 * Doubles: oversized Settings content and account catalog/vault; no Git, credential or network I/O.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { createRef } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { PublicInstance } from "@gpuix/react";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import {
	SettingsPage,
	SettingsSplit,
} from "../../src/feature/settings/settings-layout";

import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";

const roots: TestRoot[] = [];

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.length = 0;
	mock.restore();
});

it.each([false, true])(
	"scrolls page and editor panes independently and respects the preference (pinned header: %s)",
	async (pinnedHeader) => {
		const root = createTestRoot({ width: 900, height: 420 });

		roots.push(root);
		const scrollRef = createRef<PublicInstance>();

		const render = (enabled: boolean, height = 1200) =>
			root.render(
				<AppThemeContext
					value={{
						...appThemes.light,
						tokens: { ...appThemes.light.tokens, showScrollbars: enabled },
						commitTypeBadges: true,
					}}
				>
					<SettingsSplit
						list={
							<SettingsPage
								title="Options"
								testId="page"
								scrollTestId={pinnedHeader ? "page-scroll" : undefined}
								scrollRef={scrollRef}
								headerTestId="page-header"
							>
								<div style={{ height, flexShrink: 0 }}>
									<text>Page content</text>
								</div>
							</SettingsPage>
						}
						panel={{
							title: "Editor",
							label: "Editor",
							testId: "editor",
							scrollTestId: "editor-scroll",
							footerTestId: "editor-footer",
							body: (
								<div style={{ height, flexShrink: 0 }}>
									<text>Editor content</text>
								</div>
							),
							footer: <text>Save</text>,
						}}
					/>
				</AppThemeContext>
			);

		const node = (id: string) => {
			const element = root.renderer.findByTestId(id);

			if (!element) throw new Error(`Missing ${id}`);

			return element;
		};

		const settle = async () => {
			await Bun.sleep(80);
			root.renderer.advanceTime(1);
			root.renderer.flush();
		};

		render(true);
		await settle();
		const pageId = pinnedHeader ? "page-scroll" : "page";
		const page = node(pageId);
		const editor = node("editor-scroll");
		const header = root.renderer.getElementBounds(node("page-header").id);
		const footer = root.renderer.getElementBounds(node("editor-footer").id);
		const pageBar = node(`${pageId}-scrollbar-vertical`);
		const editorBar = node("editor-scroll-scrollbar-vertical");

		expect(scrollRef.current?.id).toBe(page.id);
		expect(root.renderer.getElementBounds(pageBar.id)?.height).toBeGreaterThan(
			0
		);
		expect(
			root.renderer.getElementBounds(editorBar.id)?.height
		).toBeGreaterThan(0);
		root.renderer.nativeSimulateKeyDown(pageBar.id, "end");
		await settle();
		expect(root.renderer.getScrollOffset(page.id)?.[1]).toBeLessThan(-100);
		expect(root.renderer.getScrollOffset(editor.id)?.[1]).toBe(0);
		root.renderer.nativeSimulateKeyDown(editorBar.id, "end");
		await settle();
		expect(root.renderer.getScrollOffset(editor.id)?.[1]).toBeLessThan(-100);
		expect(root.renderer.getElementBounds(node("editor-footer").id)).toEqual(
			footer
		);

		if (pinnedHeader)
			expect(root.renderer.getElementBounds(node("page-header").id)).toEqual(
				header
			);

		render(false);
		await settle();
		expect(
			root.renderer.findByTestId(`${pageId}-scrollbar-vertical`)
		).toBeUndefined();
		expect(
			root.renderer.findByTestId("editor-scroll-scrollbar-vertical")
		).toBeUndefined();
		render(true, 20);
		await settle();
		expect(
			root.renderer.getElementBounds(node(`${pageId}-scrollbar-vertical`).id)
				?.height ?? 0
		).toBe(0);
		expect(
			root.renderer.getElementBounds(
				node("editor-scroll-scrollbar-vertical").id
			)?.height ?? 0
		).toBe(0);
	}
);

it("scrolls the Settings sidebar and hides its scrollbar with the same preference", async () => {
	const root = createTestRoot({ width: 900, height: 320 });

	roots.push(root);
	const accounts = new Accounts(
		new AccountStore("/unused/scrollbar-accounts.json"),
		{
			async read() {
				return null;
			},
			async write() {
				throw new Error("No credential write expected");
			},
			async delete() {
				throw new Error("No credential deletion expected");
			},
		}
	);

	spyOn(accounts, "load").mockReturnValue([]);
	const render = (enabled: boolean) =>
		root.render(
			<AppThemeContext
				value={{
					...appThemes.light,
					tokens: { ...appThemes.light.tokens, showScrollbars: enabled },
					commitTypeBadges: true,
				}}
			>
				<AccountsSettings
					accounts={accounts}
					onBack={() => {}}
					initialSection="appearance"
					repositorySettings={{
						root: "/test/project",
						name: "Project",
						disabled: false,
					}}
				/>
			</AppThemeContext>
		);

	render(true);
	await Bun.sleep(100);
	root.renderer.advanceTime(1);
	root.renderer.flush();
	const bar = root.renderer.findByTestId(
		"settings-navigation-scrollbar-vertical"
	);

	const navigation = root.renderer.findByTestId("settings-navigation");

	if (!bar || !navigation)
		throw new Error("Missing Settings navigation scrollbar");

	expect(root.renderer.getElementBounds(bar.id)?.height).toBeGreaterThan(0);

	if (process.env.GPUIX_SETTINGS_SCROLLBAR_SCREENSHOT)
		root.renderer.captureScreenshot(
			process.env.GPUIX_SETTINGS_SCROLLBAR_SCREENSHOT
		);

	root.renderer.nativeSimulateKeyDown(bar.id, "end");
	root.renderer.advanceTime(1);
	expect(root.renderer.getScrollOffset(navigation.id)?.[1]).toBeLessThan(0);
	render(false);
	await Bun.sleep(80);
	root.renderer.flush();
	expect(
		root.renderer.findByTestId("settings-navigation-scrollbar-vertical")
	).toBeUndefined();
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath: string): string =>
	readFileSync(new URL(relativePath, import.meta.url), "utf8");

const styles = readSource("../src/renderer/src/styles.css");

const workspaceTab = readSource(
	"../src/renderer/src/fixture/desktop-toolbar/components/workspace-tab.tsx"
);

const desktopToolbar = readSource(
	"../src/renderer/src/fixture/desktop-toolbar/components/desktop-toolbar.tsx"
);

describe("workspace tab entry animation", () => {
	test("runs only while a newly mounted keyed tab is entering", () => {
		expect(styles).toContain(
			'[data-name="WorkspaceTab"][data-entering="true"]:not([data-overlay="true"])'
		);
		expect(styles).not.toContain(
			'[data-name="WorkspaceTab"]:not([data-overlay="true"])\n'
		);
		expect(workspaceTab).toContain(
			"const [isEntering, setIsEntering] = useState(!isOverlay);"
		);
		expect(workspaceTab).toContain(
			'data-entering={isEntering ? "true" : undefined}'
		);
		expect(desktopToolbar).toContain("key={workspace.session.id}");
		expect(desktopToolbar).not.toContain("key={index}");
	});

	test("clears entry state only for the direct entry animation", () => {
		const animationHandler = workspaceTab.slice(
			workspaceTab.indexOf("const finishTabContentAnimation"),
			workspaceTab.indexOf("const commandLensTarget")
		);

		expect(animationHandler).toContain("event.target === event.currentTarget");
		expect(animationHandler).toContain(
			"event.animationName === WORKSPACE_TAB_ENTRY_ANIMATION_NAME"
		);
		expect(animationHandler).toContain("setIsEntering(false);");
		expect(animationHandler).toContain("await finishClosingWorkspace(event);");
	});

	test("keeps the repository menu fixed before the scrollable tabs", () => {
		expect(desktopToolbar.indexOf("<RepositoryMenu")).toBeLessThan(
			desktopToolbar.indexOf('data-name="WorkspaceTabList"')
		);
		expect(desktopToolbar).toContain("navigationOrder={0}");
	});
});

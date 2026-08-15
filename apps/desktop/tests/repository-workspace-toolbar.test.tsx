import { describe, expect, test } from "bun:test";
import { DropdownMenu } from "@1git/ui/components/dropdown-menu";
import { renderToStaticMarkup } from "react-dom/server";
import { LiquidMenuStackProvider } from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import {
	RepositoryDiffOptions,
	RepositoryWorkspaceToolbar,
} from "../src/renderer/src/fixture/repository-workspace/components/repository-workspace-toolbar.js";

const ignoreWhitespaceChange = (): void => undefined;
const setTab = async (): Promise<void> => undefined;

describe("repository workspace toolbar", () => {
	test("renders diff options inside their Base UI menu group", () => {
		const markup = renderToStaticMarkup(
			<DropdownMenu open>
				<RepositoryDiffOptions
					ignoreWhitespace
					onSetIgnoreWhitespace={ignoreWhitespaceChange}
				/>
			</DropdownMenu>
		);

		expect(markup).toContain('data-slot="dropdown-menu-group"');
		expect(markup).toContain(">Diff<");
		expect(markup).toContain('aria-checked="true"');
		expect(markup).toContain("Ignore whitespace");
	});

	test("renders only the repository view control beside the traffic lights", () => {
		const markup = renderToStaticMarkup(
			<LiquidMenuStackProvider>
				<RepositoryWorkspaceToolbar
					ignoreWhitespace={false}
					onSetIgnoreWhitespace={ignoreWhitespaceChange}
					onSetTab={setTab}
					tab="changes"
				/>
			</LiquidMenuStackProvider>
		);

		expect(markup).toContain('aria-label="Repository view: Changes"');
		expect(markup).toContain("pl-(--desktop-titlebar-controls-width)");
		expect(markup).not.toContain("Repository actions");
	});
});

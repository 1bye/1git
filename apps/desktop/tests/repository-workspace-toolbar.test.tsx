import { describe, expect, test } from "bun:test";
import { DropdownMenu } from "@1git/ui/components/dropdown-menu";
import { renderToStaticMarkup } from "react-dom/server";
import { RepositoryDiffOptions } from "../src/renderer/src/fixture/repository-workspace/components/repository-workspace-toolbar.js";

const ignoreWhitespaceChange = (): void => undefined;

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
});

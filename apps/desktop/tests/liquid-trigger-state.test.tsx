import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LiquidMenuStackProvider } from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import {
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "../src/renderer/src/fixture/liquid-menu/components/liquid-menu.js";

const ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 8,
} as const;

const renderTrigger = ({
	defaultOpen,
	open,
}: {
	readonly defaultOpen?: boolean;
	readonly open?: boolean;
}): string =>
	renderToStaticMarkup(
		<LiquidMenuStackProvider>
			<LiquidMenuRoot
				anchorGeometry={ANCHOR_GEOMETRY}
				defaultOpen={defaultOpen}
				open={open}
			>
				<LiquidMenuTrigger data-liquid-state="caller-owned" type="button">
					Actions
				</LiquidMenuTrigger>
			</LiquidMenuRoot>
		</LiquidMenuStackProvider>
	);

describe("liquid trigger state", () => {
	test("supports controlled idle and open roots", () => {
		expect(renderTrigger({ open: false })).toContain(
			'data-liquid-state="idle"'
		);
		expect(renderTrigger({ open: true })).toContain('data-liquid-state="open"');
	});

	test("supports uncontrolled default state and owns its data contract", () => {
		const markup = renderTrigger({ defaultOpen: true });

		expect(markup).toContain('data-liquid-trigger=""');
		expect(markup).toContain('data-liquid-state="open"');
		expect(markup).not.toContain("caller-owned");
	});
});

import { render } from "@gpuix/react";
import { handlePopoverKeyDown } from "@1git/gpuix-ui/popover";

import { ExampleApp } from "./app";

render(<ExampleApp />, {
	focus: process.env.GPUIX_BACKGROUND !== "1",
	title: "GPUIX UI — Component playground",
	width: 1120,
	height: 800,
	onKeyDown(event, renderer) {
		if (handlePopoverKeyDown(event, renderer)) return;

		if (event.key !== "tab") return;

		if (event.modifiers?.shift) renderer.focusPrevious?.();
		else renderer.focusNext?.();
	},
});

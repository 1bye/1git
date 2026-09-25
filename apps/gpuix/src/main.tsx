import { render } from "@gpuix/react";

import { App } from "./app";

render(<App />, {
	focus: process.env.GPUIX_BACKGROUND !== "1",
	onKeyDown(event, renderer) {
		if (event.key !== "tab") return;
		if (event.modifiers?.shift) renderer.focusPrevious?.();
		else renderer.focusNext?.();
	},
	height: 820,
	title: "1git",
	width: 1280,
});

import { render } from "@gpuix/react";

render(<div />, {
	focus: process.env.GPUIX_BACKGROUND !== "1",
	height: 820,
	title: "1git",
	width: 1280,
});

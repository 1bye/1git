import { render } from "@gpuix/react";

import { App } from "./app";
import { windowOptions } from "./window-options";

render(<App />, {
	...windowOptions,
	focus: process.env.GPUIX_BACKGROUND !== "1",
});

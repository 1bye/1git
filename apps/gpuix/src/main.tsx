import { render } from "@gpuix/react";

import { App } from "./app";
import { windowOptions } from "./window-options";

// Temporary overflow/drag playground until real workspace restoration is wired up.
render(<App initialTabCount={8} />, {
	...windowOptions,
	focus: process.env.GPUIX_BACKGROUND !== "1",
});

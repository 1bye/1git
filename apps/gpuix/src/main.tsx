import { render } from "@gpuix/react";

import { App } from "./app";
import { windowOptions } from "./window-options";

const preview = process.env.GPUIX_PREVIEW === "1";

render(<App preview={preview} initialTabCount={preview ? 8 : 1} />, {
	...windowOptions,
	focus: process.env.GPUIX_BACKGROUND !== "1",
});

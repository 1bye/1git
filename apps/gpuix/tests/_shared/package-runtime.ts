import assert from "node:assert/strict";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const addon: unknown = require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH ?? "");

assert.ok(typeof addon === "object" && addon !== null);
assert.equal(typeof Reflect.get(addon, "GpuixRenderer"), "function");

const png = await sharp({
	create: { width: 1, height: 1, channels: 4, background: "#ff0000" },
})
	.png()
	.toBuffer();

assert.deepEqual([...(await sharp(png).raw().toBuffer())], [255, 0, 0, 255]);
process.stdout.write("Packaged runtime ready\n");

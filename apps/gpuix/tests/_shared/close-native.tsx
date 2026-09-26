import assert from "node:assert/strict";
import { GpuixRenderer } from "@gpuix/native";
import { render } from "@gpuix/react";
import { dlopen, ptr } from "bun:ffi";

const { symbols } = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_getClass: { args: ["ptr"], returns: "ptr" },
	sel_registerName: { args: ["ptr"], returns: "ptr" },
	objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "ptr" },
});

const integerMessage = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_msgSend: { args: ["ptr", "ptr", "usize"], returns: "ptr" },
}).symbols.objc_msgSend;

const send = (
	object: ReturnType<typeof symbols.objc_getClass>,
	selector: string,
	argument: ReturnType<typeof symbols.objc_getClass> = null
) => {
	const name = Buffer.from(`${selector}\0`);

	return symbols.objc_msgSend(
		object,
		symbols.sel_registerName(ptr(name)),
		argument
	);
};

const renderer = new GpuixRenderer();

process.on("unhandledRejection", (error) => {
	process.stderr.write(String(error));
	process.exit(1);
});
const setBlocked: unknown = Reflect.get(renderer, "setCloseBlocked");
const takeRequested: unknown = Reflect.get(renderer, "takeCloseRequested");

if (typeof setBlocked !== "function" || typeof takeRequested !== "function")
	throw new Error("Missing native close protection");

renderer.init({
	title: "1git close protection test",
	width: 500,
	height: 300,
	focus: true,
});
let focusId: number | undefined;

render(
	<div>
		<text
			ref={(instance) => {
				focusId = instance?.id;
			}}
			tabIndex={0}
		>
			Isolated close protection test
		</text>
	</div>,
	{ renderer }
);

const pump = async () => {
	for (let frame = 0; frame < 12; frame++) {
		const alive = renderer.tick();

		if (!alive) return false;

		await Bun.sleep(10);
	}

	return true;
};

await pump();

if (focusId === undefined) throw new Error("Native test UI was not rendered");

renderer.focusElement(focusId);
await pump();
const className = Buffer.from("NSApplication\0");
const app = send(symbols.objc_getClass(ptr(className)), "sharedApplication");
const window = send(send(app, "windows"), "firstObject");

setBlocked.call(renderer, true);
send(window, "makeKeyWindow");
await pump();
const stringClass = Buffer.from("NSString\0");
const title = Buffer.from("Close Window\0");
const menu = send(app, "windowsMenu");

const name = send(
	symbols.objc_getClass(ptr(stringClass)),
	"stringWithUTF8String:",
	ptr(title)
);

const index = Number(send(menu, "indexOfItemWithTitle:", name));
const action = Buffer.from("performActionForItemAtIndex:\0");

integerMessage(menu, symbols.sel_registerName(ptr(action)), index);
assert.equal(
	await pump(),
	true,
	"blocked Close Window action must keep window alive"
);
assert.equal(
	takeRequested.call(renderer),
	true,
	"Close Window action must notify the app"
);
send(window, "performClose:");
assert.equal(await pump(), true, "blocked native close must keep window alive");
assert.equal(
	takeRequested.call(renderer),
	true,
	"native close must notify the app"
);
assert.equal(takeRequested.call(renderer), false, "request is consumed once");
send(app, "terminate:");
assert.equal(await pump(), true, "blocked AppKit quit must keep app alive");
assert.equal(
	takeRequested.call(renderer),
	true,
	"AppKit quit must notify the app"
);
setBlocked.call(renderer, false);
assert.equal(await pump(), true, "unblocking must not replay a quit");
process.stdout.write("protected close and quit verified; explicit exit next\n");

if (process.argv[2] === "quit") send(app, "terminate:");
else send(window, "performClose:");

assert.equal(
	await pump(),
	false,
	"explicit close after unblocking should terminate"
);
process.stdout.write("explicit exit completed\n");
process.exit(0);

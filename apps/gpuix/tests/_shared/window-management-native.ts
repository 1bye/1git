import assert from "node:assert/strict";
import { GpuixRenderer } from "@gpuix/native";
import { CString, dlopen, ptr } from "bun:ffi";
import { windowOptions } from "../../src/window-options";

const { symbols } = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_getClass: { args: ["ptr"], returns: "ptr" },
	sel_registerName: { args: ["ptr"], returns: "ptr" },
	objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "ptr" },
});

const messageTwo = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_msgSend: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
}).symbols.objc_msgSend;

type NativeObject = ReturnType<typeof symbols.objc_getClass>;
const bytes = (value: string) => ptr(Buffer.from(`${value}\0`));
const selector = (value: string) => symbols.sel_registerName(bytes(value));
const nativeClass = (value: string) => symbols.objc_getClass(bytes(value));

const send = (
	object: NativeObject,
	name: string,
	argument: NativeObject = null
): NativeObject => symbols.objc_msgSend(object, selector(name), argument);

const string = (value: string) =>
	send(nativeClass("NSString"), "stringWithUTF8String:", bytes(value));

const text = (object: NativeObject) => {
	const pointer = send(object, "UTF8String");

	assert.ok(pointer, "native string must be available");

	return new CString(pointer).toString();
};

const renderer = new GpuixRenderer();

renderer.init({
	...windowOptions,
	title: "1git window management regression",
	show: true,
	focus: false,
});

for (let frame = 0; frame < 5; frame++) {
	assert.ok(renderer.tick());
	await Bun.sleep(10);
}

const app = send(nativeClass("NSApplication"), "sharedApplication");
const window = send(send(app, "windows"), "firstObject");

assert.equal(text(send(window, "accessibilityRole")), "AXWindow");
assert.equal(text(send(window, "accessibilitySubrole")), "AXStandardWindow");

for (const [attribute, encoding, requested] of [
	["AXPosition", "{CGPoint=dd}", [100, 100]],
	["AXSize", "{CGSize=dd}", [756, 450]],
	["AXSize", "{CGSize=dd}", [640, 420]],
] as const) {
	assert.equal(
		Number(
			send(window, "accessibilityIsAttributeSettable:", string(attribute))
		),
		1,
		`${attribute} must be writable`
	);
	const buffer = Buffer.alloc(16);

	buffer.writeDoubleLE(requested[0], 0);
	buffer.writeDoubleLE(requested[1], 8);
	const value = messageTwo(
		nativeClass("NSValue"),
		selector("valueWithBytes:objCType:"),
		ptr(buffer),
		bytes(encoding)
	);

	messageTwo(
		window,
		selector("accessibilitySetValue:forAttribute:"),
		value,
		string(attribute)
	);
	const actual = Buffer.alloc(16);

	send(
		send(window, "accessibilityAttributeValue:", string(attribute)),
		"getValue:",
		ptr(actual)
	);
	assert.deepEqual(
		[actual.readDoubleLE(0), actual.readDoubleLE(8)],
		[...requested],
		`${attribute} must honor window-manager requests`
	);
	assert.ok(renderer.tick(), "window must remain responsive");
}

process.stdout.write("Native accessibility move and compact resize verified\n");
process.exit(0);

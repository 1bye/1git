import assert from "node:assert/strict";
import { GpuixRenderer } from "@gpuix/native";
import { render } from "@gpuix/react";
import { CString, dlopen, ptr } from "bun:ffi";
import { AppShell } from "../../src/fixture/app-shell";
import { windowOptions } from "../../src/window-options";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { RepositoryTheme } from "../../src/styles/repository-theme";

const { symbols } = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_getClass: { args: ["ptr"], returns: "ptr" },
	sel_registerName: { args: ["ptr"], returns: "ptr" },
	objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "ptr" },
	object_getClass: { args: ["ptr"], returns: "ptr" },
	class_getInstanceMethod: { args: ["ptr", "ptr"], returns: "ptr" },
	method_getImplementation: { args: ["ptr"], returns: "ptr" },
});

const integerMessage = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_msgSend: { args: ["ptr", "ptr", "usize"], returns: "usize" },
}).symbols.objc_msgSend;

const indexedMessage = dlopen("/usr/lib/libobjc.A.dylib", {
	objc_msgSend: { args: ["ptr", "ptr", "usize"], returns: "ptr" },
}).symbols.objc_msgSend;

type NativeObject = ReturnType<typeof symbols.objc_getClass>;

function selector(name: string): NativeObject {
	return symbols.sel_registerName(ptr(Buffer.from(`${name}\0`)));
}

function nativeClass(name: string): NativeObject {
	return symbols.objc_getClass(ptr(Buffer.from(`${name}\0`)));
}

function send(
	object: NativeObject,
	name: string,
	argument: NativeObject = null
): NativeObject {
	return symbols.objc_msgSend(object, selector(name), argument);
}

function integer(object: NativeObject, name: string, argument = 0): number {
	return Number(integerMessage(object, selector(name), argument));
}

const renderer = new GpuixRenderer();

process.on("unhandledRejection", (error) => {
	process.stderr.write(String(error));
	process.exit(1);
});

renderer.init({
	...windowOptions,
	title: "1git sidebar vibrancy test",
	width: 980,
	height: 640,
	show: true,
	focus: false,
});

const app = send(nativeClass("NSApplication"), "sharedApplication");

const appearanceName =
	process.argv[2] === "dark"
		? "NSAppearanceNameDarkAqua"
		: "NSAppearanceNameAqua";

const nativeName = send(
	nativeClass("NSString"),
	"stringWithUTF8String:",
	ptr(Buffer.from(`${appearanceName}\0`))
);

const applicationAppearance = send(
	nativeClass("NSAppearance"),
	"appearanceNamed:",
	nativeName
);

send(app, "setAppearance:", applicationAppearance);
const setWindowAppearance: unknown = Reflect.get(
	renderer,
	"setWindowAppearance"
);

assert.ok(
	typeof setWindowAppearance === "function",
	"native appearance patch must be present"
);
assert.throws(
	() => Reflect.apply(setWindowAppearance, renderer, ["invalid"]),
	/light or dark/
);
// App normally sets the window theme; this probe renders AppShell directly.
Reflect.apply(setWindowAppearance, renderer, [process.argv[2]]);
render(
	<AppThemeContext
		value={{
			...RepositoryTheme.create(
				appThemes[process.argv[2] === "dark" ? "dark" : "light"],
				process.argv[3]
			),
			commitTypeBadges: true,
		}}
	>
		<AppShell
			workspaceLabel="Vibrancy probe"
			toolbar={<div style={{ height: 42, flexShrink: 0 }} />}
			rail={<div style={{ width: 48, flexShrink: 0 }} />}
		>
			<text style={{ padding: 24, color: "#111111" }}>
				Opaque white workspace
			</text>
		</AppShell>
	</AppThemeContext>,
	{ renderer }
);

for (let frame = 0; frame < 20; frame++) {
	assert.ok(renderer.tick(), "probe window must remain alive");
	await Bun.sleep(10);
}

const window = send(send(app, "windows"), "firstObject");
const subviews = send(send(window, "contentView"), "subviews");
const effectClass = nativeClass("NSVisualEffectView");
let backdrop: NativeObject = null;

for (let index = 0; index < integer(subviews, "count"); index++) {
	const view = indexedMessage(subviews, selector("objectAtIndex:"), index);

	if (Number(send(view, "isKindOfClass:", effectClass))) backdrop = view;
}

assert.ok(backdrop, "real NSVisualEffectView must exist behind the content");
assert.equal(
	integer(window, "isOpaque"),
	0,
	"window must allow native vibrancy"
);
assert.equal(integer(backdrop, "material"), 7, "material must be Sidebar");
assert.equal(integer(backdrop, "blendingMode"), 0, "blend behind the window");
assert.equal(integer(backdrop, "state"), 1, "material must remain active");
const effectiveName = send(send(backdrop, "effectiveAppearance"), "name");
const nameBytes = send(effectiveName, "UTF8String");

assert.ok(nameBytes, "effective appearance must have a name");
assert.equal(
	new CString(nameBytes).toString(),
	process.argv[2] === "dark"
		? "NSAppearanceNameVibrantDark"
		: "NSAppearanceNameVibrantLight",
	"the native backdrop must inherit the selected window appearance"
);

for (const choice of ["dark", "light", "dark"] as const) {
	Reflect.apply(setWindowAppearance, renderer, [choice]);
	const getSystemAppearance: unknown = Reflect.get(
		renderer,
		"getSystemAppearance"
	);

	assert.ok(typeof getSystemAppearance === "function");
	assert.equal(
		Reflect.apply(getSystemAppearance, renderer, []),
		process.argv[2] === "dark" ? "dark" : "light",
		"system appearance must ignore the window override"
	);

	for (let frame = 0; frame < 10; frame++) {
		assert.ok(renderer.tick(), "theme switching must preserve the live window");
		await Bun.sleep(10);
	}

	const chosenName =
		choice === "dark" ? "NSAppearanceNameDarkAqua" : "NSAppearanceNameAqua";

	const materialName =
		choice === "dark"
			? "NSAppearanceNameVibrantDark"
			: "NSAppearanceNameVibrantLight";

	for (const [object, expectedName] of [
		[window, chosenName],
		[backdrop, materialName],
	] as const) {
		const bytes = send(
			send(send(object, "effectiveAppearance"), "name"),
			"UTF8String"
		);

		assert.ok(bytes);
		assert.equal(
			new CString(bytes).toString(),
			expectedName,
			"window and blur must follow the selected theme"
		);
	}

	assert.equal(
		integer(backdrop, "material"),
		7,
		"theme switching must retain Sidebar blur"
	);
	assert.equal(
		integer(backdrop, "blendingMode"),
		0,
		"theme switching must retain behind-window blending"
	);
	const systemBytes = send(
		send(send(app, "effectiveAppearance"), "name"),
		"UTF8String"
	);

	assert.ok(systemBytes);
	assert.equal(
		new CString(systemBytes).toString(),
		appearanceName,
		"a window preference must not change application appearance"
	);
}

const updateLayer = selector("updateLayer");

assert.equal(
	symbols.method_getImplementation(
		symbols.class_getInstanceMethod(
			symbols.object_getClass(backdrop),
			updateLayer
		)
	),
	symbols.method_getImplementation(
		symbols.class_getInstanceMethod(effectClass, updateLayer)
	),
	"AppKit must own layer updates without stripping tint or saturation"
);
process.stdout.write("Native sidebar vibrancy verified\n");
send(window, "performClose:");
renderer.tick();
process.exit(0);

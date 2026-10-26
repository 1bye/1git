/**
 * Covers: native image validation, bounded caching, bundle refreshes and renderer isolation.
 * Real: icon cache and PNG data URLs. Doubles: AppKit boundary; no files, graphics or application launches.
 */
import { expect, it, mock } from "bun:test";
import { ApplicationIcons } from "../../src/feature/editor-settings/application-icons";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

it("reuses icons within a renderer and refreshes when a bundle is replaced", () => {
	const getApplicationIcon = mock(() => png);
	const renderer = { getApplicationIcon };

	const first = ApplicationIcons.load(
		renderer,
		"/Applications/Editor.app",
		"version-1"
	);

	expect(first).toBe(`data:image/png;base64,${png.toString("base64")}`);
	expect(
		ApplicationIcons.load(renderer, "/Applications/Editor.app", "version-1")
	).toBe(first);
	expect(getApplicationIcon).toHaveBeenCalledTimes(1);
	ApplicationIcons.load(renderer, "/Applications/Editor.app", "version-2");
	expect(getApplicationIcon).toHaveBeenCalledTimes(2);
	ApplicationIcons.load(
		{ getApplicationIcon },
		"/Applications/Editor.app",
		"version-2"
	);
	expect(getApplicationIcon).toHaveBeenCalledTimes(3);
});
it("falls back for unavailable native support, invalid data or a failed lookup, and permits retry after a bundle refresh", () => {
	expect(ApplicationIcons.load({}, "/Applications/Editor.app")).toBeUndefined();

	for (const value of [
		null,
		"data:image/png;base64,abc",
		new Uint8Array([1, 2, 3]),
		new Uint8Array(257 * 1024),
	]) {
		expect(
			ApplicationIcons.load(
				{ getApplicationIcon: () => value },
				"/Applications/Editor.app"
			)
		).toBeUndefined();
	}

	const getApplicationIcon = mock((): Uint8Array => {
		throw new Error("AppKit unavailable");
	});

	const renderer = { getApplicationIcon };

	expect(
		ApplicationIcons.load(renderer, "/Applications/Editor.app", "old")
	).toBeUndefined();
	expect(
		ApplicationIcons.load(renderer, "/Applications/Editor.app", "old")
	).toBeUndefined();
	expect(getApplicationIcon).toHaveBeenCalledTimes(1);
	getApplicationIcon.mockImplementation(() => png);
	expect(
		ApplicationIcons.load(renderer, "/Applications/Editor.app", "new")
	).toBeDefined();
});
it("evicts old entries instead of retaining an unbounded collection of application images", () => {
	const getApplicationIcon = mock(() => png);
	const renderer = { getApplicationIcon };

	for (let n = 0; n < 65; n++)
		ApplicationIcons.load(renderer, `/Applications/Editor${n}.app`);

	ApplicationIcons.load(renderer, "/Applications/Editor0.app");
	expect(getApplicationIcon).toHaveBeenCalledTimes(66);
});

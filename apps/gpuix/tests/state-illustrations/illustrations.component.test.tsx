/**
 * Covers: the shared illustration family, decorative accessibility, compact sizing and centered messages.
 * Real: GPUIX SVG/layout renderer and the app's message composition.
 * Doubles: static message content; no filesystem, Git or account reads.
 * Requires: patched native addon with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { SaxesParser } from "saxes";
import { StateArtwork } from "../../src/fixture/state-artwork";
import { StateMessage } from "../../src/fixture/state-message";
import { appTokens } from "../../src/styles/tokens";

const variants = [
	"empty",
	"file",
	"history",
	"stash",
	"repository",
	"search",
	"loading",
	"error",
	"unavailable",
	"accounts",
	"clone",
] as const;

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 1000, height: 760 });
	root.renderer.clockPause();
});
afterEach(() => root.unmount());

it("renders original thin-line artwork with shared sizing and no accessible or interactive noise", () => {
	root.render(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				padding: 16,
				gap: 16,
			}}
		>
			{[0, 4, 8].map((start) => (
				<div
					key={start}
					style={{
						display: "flex",
						flexDirection: "row",
						flexGrow: 1,
						gap: 16,
					}}
				>
					{variants.slice(start, start + 4).map((name) => (
						<div
							key={name}
							style={{
								display: "flex",
								flexDirection: "column",
								flexGrow: 1,
								flexBasis: 0,
								borderWidth: 1,
								borderColor: appTokens.colors.border,
								backgroundColor: "#ffffff",
							}}
						>
							<StateMessage artwork={name} title={name} />
						</div>
					))}
				</div>
			))}
		</div>
	);

	const sources = new Set<string>();

	for (const name of variants) {
		const art = root.renderer.findByTestId(`state-art-${name}`);
		const source = art?.customProps?.source;

		expect(art?.type).toBe("svg");
		expect(art?.customProps?.["aria-hidden"]).toBe(true);
		expect(art?.style.width).toBe(160);
		expect(art?.style.height).toBe(112);
		expect(art?.style.color).toBe(appTokens.colors.textMuted);
		expect(art?.style.pointerEvents).toBe("none");

		if (typeof source !== "string")
			throw new Error(`Missing ${name} vector source`);

		const parser = new SaxesParser();
		let svg = false;

		parser.on("opentag", (tag) => {
			if (tag.name === "svg") {
				svg = true;
				expect(tag.attributes.viewBox).toBe("0 0 160 112");
				expect(tag.attributes["stroke-width"]).toBe("1");
			}
		});
		parser.write(source).close();
		expect(svg).toBe(true);
		sources.add(source);
	}

	expect(sources.size).toBe(variants.length);

	if (process.env.GPUIX_ARTWORK_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_ARTWORK_SCREENSHOT);
});

it.each([false, true])(
	"centers the message and keeps its artwork above the text (compact: %s)",
	(compact) => {
		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: 300,
					height: 220,
					backgroundColor: "#ffffff",
				}}
			>
				<StateMessage
					testId="message"
					artwork="loading"
					title="Loading diff…"
					description="Please wait"
					compact={compact}
				/>
			</div>
		);
		const art = root.renderer.findByTestId("state-art-loading");
		const message = root.renderer.findByTestId("message");
		const box = art && root.renderer.getElementBounds(art.id);

		expect(box?.width).toBe(compact ? 80 : 160);
		expect(box?.height).toBe(compact ? 56 : 112);
		expect(message?.customProps?.["aria-label"]).toBe("Loading diff…");
		expect(message?.customProps?.role).toBe("status");

		if (!box) throw new Error("Missing illustration bounds");

		expect(box.x + box.width / 2).toBeCloseTo(150, 0);
		expect(root.renderer.getPaintedText()).toContain("Loading diff…");
		expect(root.renderer.getPaintedText()).toContain("Please wait");

		root.render(<StateArtwork name="error" compact={compact} />);
		expect(root.renderer.findByTestId("state-art-loading")).toBeUndefined();
		expect(root.renderer.findByTestId("state-art-error")).toBeDefined();
	}
);

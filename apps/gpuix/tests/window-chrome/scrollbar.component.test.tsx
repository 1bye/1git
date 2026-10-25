/**
 * Covers: light/dark scrollbar contrast, transparent idle tracks and same-frame thumb movement.
 * Real: app palettes, native scrollbar painting, virtual scrolling and screenshot pixels.
 * Doubles: generated rows; no repositories or user preferences.
 * Requires: patched native addon and macOS graphics access.
 */
import { expect, it } from "bun:test";
import { useRef } from "react";
import { createTestRoot } from "@gpuix/react/testing";
import type { PublicInstance } from "@gpuix/react";
import { Scrollbars } from "@1git/gpuix-ui/scrollbar";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { appThemes } from "../../src/styles/theme";
import type { AppAppearance } from "../../src/styles/tokens";

function Fixture({ appearance }: { appearance: AppAppearance }) {
	const target = useRef<PublicInstance>(null);
	const theme = appThemes[appearance];

	return (
		<div
			style={{
				width: 400,
				height: 300,
				backgroundColor: theme.colors.editorSurface,
			}}
		>
			<virtual-list
				ref={target}
				testId="list"
				estimatedItemHeight={28}
				style={{ width: 300, height: 240 }}
			>
				{Array.from({ length: 100 }, (_, index) => (
					<div
						key={index}
						style={{
							height: 28,
							width: "100%",
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							flexShrink: 0,
							paddingLeft: 12,
						}}
					>
						<text
							style={{
								fontSize: 12,
								whiteSpace: "nowrap",
								color: theme.colors.editorInk,
							}}
						>
							File {index}.tsx
						</text>
					</div>
				))}
			</virtual-list>
			<Scrollbars
				vertical={target}
				tokens={{ ...theme.tokens, showScrollbars: true }}
			/>
		</div>
	);
}

it.each(["light", "dark"] as const)(
	"paints a subtle %s thumb on a clear track and follows each native wheel frame",
	async (appearance) => {
		const directory = await mkdtemp(join(tmpdir(), "1git-scrollbar-"));
		const root = createTestRoot({ width: 400, height: 300 });

		try {
			root.render(<Fixture appearance={appearance} />);
			root.renderer.advanceTime(1);
			const bar = root.renderer.findByTestId("scrollbar-vertical")!;
			const bounds = root.renderer.getElementBounds(bar.id)!;

			const background = [1, 3, 5].map((offset) =>
				Number.parseInt(
					appThemes[appearance].colors.editorSurface.slice(offset, offset + 2),
					16
				)
			);

			const foreground = [1, 3, 5].map((offset) =>
				Number.parseInt(
					appThemes[appearance].tokens.colors.textMuted.slice(
						offset,
						offset + 2
					),
					16
				)
			);

			const pixels = async (name: string) => {
				const path = join(directory, `${name}.png`);

				root.renderer.captureScreenshot(path);
				const { data, info } = await sharp(path)
					.ensureAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true });

				const scale = info.width / 400;

				const color = (x: number, y: number) => {
					const start =
						(Math.floor(y * scale) * info.width + Math.floor(x * scale)) * 4;

					return [...data.subarray(start, start + 3)];
				};

				return { color, path };
			};

			const before = await pixels("before");

			expect(before.color(bounds.x + 1, bounds.y + 100)).toEqual(background);
			const thumb = before.color(bounds.x + bounds.width / 2, bounds.y + 10);

			for (const channel of [0, 1, 2])
				expect(
					Math.abs(
						thumb[channel]! -
							Math.round(
								background[channel]! * 0.7 + foreground[channel]! * 0.3
							)
					)
				).toBeLessThanOrEqual(2);

			const thumbTop = (image: Awaited<ReturnType<typeof pixels>>) => {
				for (let y = Math.ceil(bounds.y); y < bounds.y + bounds.height; y++) {
					const pixel = image.color(bounds.x + bounds.width / 2, y);

					if (
						pixel.some(
							(value, channel) => Math.abs(value - background[channel]!) > 8
						)
					)
						return y;
				}

				throw new Error("Missing painted scrollbar thumb");
			};

			root.renderer.nativeSimulateScrollWheel(100, 80, 0, -900);
			const after = await pixels("after");

			expect(thumbTop(after)).toBeGreaterThan(thumbTop(before) + 40);
			// The visible scrollbar also forwards wheel input over its own hit area.
			const list = root.renderer.findByTestId("list")!;
			const offset = root.renderer.getScrollOffset(list.id)![1];

			root.renderer.nativeSimulateScrollWheel(
				bounds.x + bounds.width / 2,
				bounds.y + 80,
				0,
				-60
			);
			expect(root.renderer.getScrollOffset(list.id)![1]).toBeLessThan(offset!);

			if (process.env.GPUIX_SCROLLBAR_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_SCROLLBAR_SCREENSHOT}-${appearance}.png`
				);
		} finally {
			root.unmount();
			await rm(directory, { recursive: true, force: true });
		}
	}
);

it("does not paint a deferred scrollbar from a hidden workspace over Settings", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-hidden-scrollbar-"));
	const root = createTestRoot({ width: 400, height: 300 });

	const show = (hidden: boolean) =>
		root.render(
			<div style={{ width: 400, height: 300, backgroundColor: "#ffffff" }}>
				<div style={{ visibility: hidden ? "hidden" : "visible" }}>
					<Fixture appearance="light" />
				</div>
			</div>
		);

	try {
		show(false);
		root.renderer.advanceTime(1);
		const bar = root.renderer.findByTestId("scrollbar-vertical")!;
		const bounds = root.renderer.getElementBounds(bar.id)!;

		show(true);
		root.renderer.advanceTime(1);
		const path = join(directory, "hidden.png");

		root.renderer.captureScreenshot(path);
		const { data, info } = await sharp(path)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scale = info.width / 400;

		const index =
			(Math.floor((bounds.y + 10) * scale) * info.width +
				Math.floor((bounds.x + bounds.width / 2) * scale)) *
			info.channels;

		expect([...data.subarray(index, index + 3)]).toEqual([255, 255, 255]);
		show(false);
		root.renderer.advanceTime(1);
		expect(root.renderer.getElementBounds(bar.id)?.height).toBeGreaterThan(100);
	} finally {
		root.unmount();
		await rm(directory, { recursive: true, force: true });
	}
});

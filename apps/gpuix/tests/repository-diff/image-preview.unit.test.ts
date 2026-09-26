/**
 * Covers: bounded image decoding, orientation, transparency and static SVG resource policy.
 * Real: Sharp and Saxes with in-memory image content.
 * Doubles: no repository, network or native UI.
 * Requires: installed Sharp platform binary.
 */
import { expect, it } from "bun:test";
import sharp from "sharp";
import {
	ImagePreviewDecoder,
	imageLimits,
} from "../../src/feature/repository-workspace/lib/image-preview";
import {
	previewPixel,
	rasterContent,
	svgContent,
} from "../_shared/image-content";

it("prepares PNG, JPEG, WebP and full-color SVG with original dimensions and byte sizes", async () => {
	for (const content of [
		await rasterContent("png"),
		await rasterContent("jpeg"),
		await rasterContent("webp"),
		svgContent(),
	]) {
		const image = await ImagePreviewDecoder.prepare(
			content,
			new AbortController().signal
		);

		expect(image.width).toBe(32);
		expect(image.height).toBe(16);
		expect(image.sizeBytes).toBe(content.sizeBytes);
		expect(image.src).toStartWith("data:image/png;base64,");
		expect((await previewPixel(image.src))[0]).toBeGreaterThan(240);
		expect((await previewPixel(image.src))[1]).toBeLessThan(15);
	}
});

it("shows transparency over a subtle checkerboard and handles tiny images", async () => {
	for (const width of [1, 32]) {
		const image = await ImagePreviewDecoder.prepare(
			await rasterContent("png", "transparent", width, width),
			new AbortController().signal
		);

		const pixel = await previewPixel(image.src);

		expect(pixel[3]).toBe(255);
		expect(pixel[0]).toBeGreaterThanOrEqual(238);
		expect(pixel[0]).toBeLessThanOrEqual(250);
	}
});

it("orients JPEGs before reporting dimensions and bounds the decoded preview", async () => {
	const original = await rasterContent("jpeg", "blue", 3000, 1000);

	const bytes = await sharp(Buffer.from(original.content, "base64"))
		.withMetadata({ orientation: 6 })
		.jpeg()
		.toBuffer();

	const image = await ImagePreviewDecoder.prepare(
		{ ...original, content: bytes.toString("base64"), sizeBytes: bytes.length },
		new AbortController().signal
	);

	const output = await sharp(
		Buffer.from(image.src.split(",")[1] ?? "", "base64")
	).metadata();

	expect(image.width).toBe(1000);
	expect(image.height).toBe(3000);
	expect(output.height).toBe(imageLimits.previewDimension);
});

it("rejects malformed, oversized, animated and aborted content without a renderable source", async () => {
	for (const content of [
		svgContent("not an image"),
		svgContent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>'
		),
		svgContent("x".repeat(imageLimits.bytes + 1)),
	]) {
		await expect(
			ImagePreviewDecoder.prepare(content, new AbortController().signal)
		).rejects.toBeInstanceOf(Error);
	}

	const animated = await sharp(
		Buffer.from([
			255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
		]),
		{ raw: { width: 2, height: 2, channels: 4, pageHeight: 1 } }
	)
		.webp({ loop: 0, delay: [100, 100] })
		.toBuffer();

	await expect(
		ImagePreviewDecoder.prepare(
			{
				content: animated.toString("base64"),
				encoding: "base64",
				sizeBytes: animated.length,
				path: "animated.webp",
				revision: "TEST",
			},
			new AbortController().signal
		)
	).rejects.toThrow("Animated images");

	const controller = new AbortController();

	controller.abort();
	await expect(
		ImagePreviewDecoder.prepare(svgContent(), controller.signal)
	).rejects.toBeInstanceOf(Error);
});

it("allows local SVG gradients and references but rejects external or active content", () => {
	const wrap = (body: string) =>
		Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="16">${body}</svg>`
		);

	expect(() =>
		ImagePreviewDecoder.validateSvg(
			wrap(
				'<defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient><rect id="shape" width="32" height="16"/></defs><style>.art { fill: url(#paint); }</style><use class="art" href="#shape"/>'
			)
		)
	).not.toThrow();

	for (const body of [
		'<image href="https://example.invalid/a.png"/>',
		'<image xlink:href="file:///etc/passwd"/>',
		'<image href="../private.png"/>',
		'<image href="data:image/png;base64,AAAA"/>',
		'<image href="&#104;ttps://example.invalid/a.png"/>',
		'<use href="other.svg#shape"/>',
		'<rect style="fill: url(https://example.invalid/a.svg)"/>',
		'<style><![CDATA[@import "https://example.invalid/a.css";]]></style>',
		"<style>.art { fill: u\\72l(https://example.invalid/a.svg); }</style>",
		"<script>alert(1)</script>",
		"<foreignObject/>",
		'<rect onload="alert(1)"/>',
		'<animate attributeName="href" to="file:///tmp/a.png"/>',
	])
		expect(() => ImagePreviewDecoder.validateSvg(wrap(body))).toThrow();

	expect(() =>
		ImagePreviewDecoder.validateSvg(
			Buffer.from(
				'<!DOCTYPE svg [<!ENTITY file SYSTEM "file:///etc/passwd">]><svg/>'
			)
		)
	).toThrow();
	expect(() =>
		ImagePreviewDecoder.validateSvg(
			Buffer.from('<?xml-stylesheet href="evil.css"?><svg/>')
		)
	).toThrow();
	expect(() =>
		ImagePreviewDecoder.validateSvg(wrap("<g/>".repeat(imageLimits.svgNodes)))
	).toThrow();
});

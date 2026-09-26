import type { FileContent } from "@1git/git";
import { SaxesParser } from "saxes";
import sharp from "sharp";

/** Bounds repository-owned image input and the bitmap sent to GPUIX. */
export const imageLimits = {
	bytes: 8 * 1024 * 1024,
	svgBytes: 512 * 1024,
	pixels: 16 * 1024 * 1024,
	dimension: 8192,
	previewDimension: 2048,
	svgNodes: 10_000,
	decodeSeconds: 3,
} as const;

/** Validated, bounded preview pixels; dimensions and size describe the original file. */
export interface ImagePreview {
	readonly src: string;
	readonly width: number;
	readonly height: number;
	readonly sizeBytes: number;
}

const svgNamespace = "http://www.w3.org/2000/svg";
const localReference = /^#[\w:.-]+$/u;
const cssUrl = /url\s*\(([^)]*)\)/giu;

const forbiddenElements = new Set([
	"script",
	"foreignobject",
	"animate",
	"animatetransform",
	"animatemotion",
	"set",
]);

const checker = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#fafafa"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#eeeeef"/></svg>'
);

const validateCss = (value: string): void => {
	// Escapes and at-rules could disguise external URLs; this static preview accepts neither.
	if (/[\\@]/u.test(value))
		throw new Error(
			"SVG CSS escapes and at-rules are not supported in previews."
		);

	for (const match of value.matchAll(cssUrl)) {
		const reference = match[1]?.trim().replace(/^(['"])(.*)\1$/u, "$2") ?? "";

		if (!localReference.test(reference))
			throw new Error("SVG external resources are not allowed in previews.");
	}
};

/** Decodes selected images off the UI thread and never forwards untrusted SVG to GPUIX. */
export class ImagePreviewDecoder {
	private constructor() {}

	static validateSvg(bytes: Buffer): void {
		if (bytes.length > imageLimits.svgBytes)
			throw new Error("SVG is too large to preview (512 KiB limit).");

		const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		const parser = new SaxesParser({ xmlns: true });
		let nodes = 0;
		let style: string | null = null;

		parser.on("doctype", () => {
			throw new Error(
				"SVG document types and entities are not allowed in previews."
			);
		});
		parser.on("processinginstruction", () => {
			throw new Error(
				"SVG processing instructions are not allowed in previews."
			);
		});
		parser.on("opentag", (tag) => {
			nodes += 1;

			if (nodes > imageLimits.svgNodes)
				throw new Error("SVG is too complex to preview safely.");

			if (
				nodes === 1 &&
				(tag.local !== "svg" || (tag.uri && tag.uri !== svgNamespace))
			)
				throw new Error("Not a supported SVG image.");

			if (forbiddenElements.has(tag.local.toLowerCase()))
				throw new Error(
					"SVG scripts, embedded documents and animations are not supported in previews."
				);

			for (const attribute of Object.values(tag.attributes)) {
				const name = attribute.local.toLowerCase();

				if (
					name.startsWith("on") ||
					(name === "base" &&
						attribute.uri === "http://www.w3.org/XML/1998/namespace")
				)
					throw new Error(
						"SVG active content and external bases are not allowed in previews."
					);

				if (
					(name === "href" || name === "src") &&
					!localReference.test(attribute.value.trim())
				)
					throw new Error(
						"SVG external resources are not allowed in previews."
					);

				if (name !== "id" && name !== "d" && name !== "xmlns")
					validateCss(attribute.value);
			}

			if (tag.local === "style") style = "";
		});
		const collectStyle = (text: string): void => {
			if (style !== null) style += text;
		};

		parser.on("text", collectStyle);
		parser.on("cdata", collectStyle);
		parser.on("closetag", (tag) => {
			if (tag.local === "style" && style !== null) {
				validateCss(style);
				style = null;
			}
		});
		parser.write(source).close();
	}

	static async prepare(
		content: FileContent,
		signal: AbortSignal
	): Promise<ImagePreview> {
		signal.throwIfAborted();
		const bytes = Buffer.from(content.content, content.encoding);

		if (bytes.length > imageLimits.bytes)
			throw new Error("Image is too large to preview (8 MiB limit).");

		const raster =
			bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
			(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
			(bytes.toString("ascii", 0, 4) === "RIFF" &&
				bytes.toString("ascii", 8, 12) === "WEBP");

		if (!raster) ImagePreviewDecoder.validateSvg(bytes);

		const decoder = sharp(bytes, {
			limitInputPixels: imageLimits.pixels,
			failOn: "warning",
			density: 72,
		}).timeout({ seconds: imageLimits.decodeSeconds });

		const metadata = await decoder.metadata();
		const { width, height } = metadata.autoOrient;

		if (!["png", "jpeg", "webp", "svg"].includes(metadata.format))
			throw new Error("Only PNG, JPEG, WebP and SVG previews are supported.");

		if (
			!width ||
			!height ||
			width > imageLimits.dimension ||
			height > imageLimits.dimension ||
			width * height > imageLimits.pixels
		)
			throw new Error(
				"Image dimensions exceed the preview limit (8192 px per side, 16 megapixels)."
			);

		if ((metadata.pages ?? 1) > 1)
			throw new Error("Animated images are not supported in this preview yet.");

		signal.throwIfAborted();
		const preview = await decoder
			.autoOrient()
			.resize({
				width: imageLimits.previewDimension,
				height: imageLimits.previewDimension,
				fit: "inside",
				withoutEnlargement: true,
			})
			.png()
			.toBuffer({ resolveWithObject: true });

		signal.throwIfAborted();
		// Bake the transparency grid into preview pixels, not hundreds of retained UI cells.
		const tile =
			preview.info.width < 16 || preview.info.height < 16
				? await sharp(checker)
						.extract({
							left: 0,
							top: 0,
							width: Math.min(16, preview.info.width),
							height: Math.min(16, preview.info.height),
						})
						.png()
						.toBuffer()
				: checker;

		const pixels = await sharp({
			create: {
				width: preview.info.width,
				height: preview.info.height,
				channels: 4,
				background: "#fafafa",
			},
		})
			.composite([{ input: tile, tile: true }, { input: preview.data }])
			.png()
			.toBuffer();

		signal.throwIfAborted();

		return {
			src: `data:image/png;base64,${pixels.toString("base64")}`,
			width,
			height,
			sizeBytes: bytes.length,
		};
	}
}

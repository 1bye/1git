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
	/** Validated source retained only for this selected image, so resize never rereads Git. */
	readonly svg?: FileContent;
}

/** Available image space in logical pixels and the desired backing-pixel scale. */
export interface ImagePreviewViewport {
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
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

const svgBaseDensity = 72;
const svgMaxDensity = 100_000;
const checkerSquareSize = 8;

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
		signal: AbortSignal,
		viewport?: ImagePreviewViewport
	): Promise<ImagePreview> {
		signal.throwIfAborted();

		if (
			viewport &&
			Object.values(viewport).some(
				(value) => !Number.isFinite(value) || value <= 0
			)
		)
			throw new Error(
				"Image preview viewport must have positive, finite dimensions and pixel ratio."
			);

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

		let decoder = sharp(bytes, {
			limitInputPixels: imageLimits.pixels,
			failOn: "warning",
			density: svgBaseDensity,
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

		const svg = metadata.format === "svg";
		let previewWidth: number = imageLimits.previewDimension;
		let previewHeight: number = imageLimits.previewDimension;
		let logicalWidth: number | null = null;

		if (svg) {
			const fit = Math.min(
				(viewport?.width ?? imageLimits.previewDimension) / width,
				(viewport?.height ?? imageLimits.previewDimension) / height
			);

			const scale = Math.min(
				fit * (viewport?.pixelRatio ?? 1),
				imageLimits.previewDimension / width,
				imageLimits.previewDimension / height,
				svgMaxDensity / svgBaseDensity
			);

			previewWidth = Math.max(1, Math.round(width * scale));
			previewHeight = Math.max(1, Math.round(height * scale));
			logicalWidth = width * fit;
			// Rasterize vectors at the target resolution; resizing a natural-size bitmap loses detail.
			decoder = sharp(bytes, {
				limitInputPixels: imageLimits.pixels,
				failOn: "warning",
				density: Math.max(1, svgBaseDensity * scale),
			}).timeout({ seconds: imageLimits.decodeSeconds });
		}

		signal.throwIfAborted();
		const preview = await decoder
			.autoOrient()
			.resize({
				width: previewWidth,
				height: previewHeight,
				fit: "inside",
				withoutEnlargement: !svg,
			})
			.png()
			.toBuffer({ resolveWithObject: true });

		signal.throwIfAborted();
		// Bake the transparency grid into preview pixels, not hundreds of retained UI cells.
		const square = logicalWidth
			? Math.min(
					Math.max(preview.info.width, preview.info.height),
					Math.max(
						1,
						Math.round((checkerSquareSize * preview.info.width) / logicalWidth)
					)
				)
			: checkerSquareSize;

		const tileWidth = Math.min(square * 2, preview.info.width);
		const tileHeight = Math.min(square * 2, preview.info.height);

		const checker = Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}"><rect width="100%" height="100%" fill="#fafafa"/><path d="M0 0h${square}v${square}H0zM${square} ${square}h${square}v${square}H${square}z" fill="#eeeeef"/></svg>`
		);

		const pixels = await sharp({
			create: {
				width: preview.info.width,
				height: preview.info.height,
				channels: 4,
				background: "#fafafa",
			},
		})
			.composite([
				{ input: checker, tile: true, gravity: "northwest" },
				{ input: preview.data },
			])
			.png()
			.toBuffer();

		signal.throwIfAborted();

		return {
			src: `data:image/png;base64,${pixels.toString("base64")}`,
			width,
			height,
			sizeBytes: bytes.length,
			...(svg ? { svg: content } : {}),
		};
	}
}

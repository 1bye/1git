import type { FileContent } from "@1git/git";
import sharp from "sharp";

export const rasterContent = async (
	format: "png" | "jpeg" | "webp" = "png",
	background = "#ff0000",
	width = 32,
	height = 16
): Promise<FileContent> => {
	const bytes = await sharp({
		create: { width, height, channels: 4, background },
	})
		.toFormat(format)
		.toBuffer();

	return {
		content: bytes.toString("base64"),
		encoding: "base64",
		sizeBytes: bytes.length,
		path: `image.${format}`,
		revision: "TEST",
	};
};

export const svgContent = (
	source = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>'
): FileContent => ({
	content: source,
	encoding: "utf8",
	sizeBytes: Buffer.byteLength(source),
	path: "image.svg",
	revision: "TEST",
});

export const previewPixel = async (src: string): Promise<readonly number[]> => {
	const bytes = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
	const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();

	return [...pixels.subarray(0, 4)];
};

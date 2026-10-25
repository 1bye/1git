import { Buffer } from "node:buffer";
import type { APIRoute } from "astro";
import sharp from "sharp";
import clouds from "../assets/atmosphere/cloud-wide.webp?inline";
import screenshot from "../assets/screens/changes.webp?inline";
import lettering from "../assets/social/lettering.svg?raw";

const pngDataUrl = async (source: string): Promise<string> => {
	if (!source.startsWith("data:image/"))
		throw new Error("OG artwork must embed its source images at build time");

	// The SVG rasterizer cannot decode embedded WebP consistently across platforms.
	const png = await sharp(
		Buffer.from(source.slice(source.indexOf(",") + 1), "base64")
	)
		.png()
		.toBuffer();

	return `data:image/png;base64,${png.toString("base64")}`;
};

/** Build a static sharing image without runtime fonts, JavaScript or remote assets. */
export const GET: APIRoute = async () => {
	const [windowImage, cloudImage] = await Promise.all([
		pngDataUrl(screenshot),
		pngDataUrl(clouds),
	]);

	const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="35%" cy="44%" r="82%">
      <stop stop-color="#5a7fc2"/><stop offset="1" stop-color="#a9bee2"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="16"/></filter>
    <clipPath id="window"><rect x="630" y="102" width="920" height="604" rx="20"/></clipPath>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".68" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
    <mask id="window-fade"><rect x="610" y="82" width="960" height="644" fill="url(#fade)"/></mask>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" filter="url(#grain)" opacity=".1" style="mix-blend-mode:overlay"/>
  <g mask="url(#window-fade)">
    <rect x="630" y="115" width="920" height="604" rx="20" fill="#1b376a" opacity=".22" filter="url(#shadow)"/>
    <image x="630" y="102" width="920" height="604" href="${windowImage}" clip-path="url(#window)"/>
  </g>
  <image x="500" y="410" width="800" height="416" href="${cloudImage}" opacity=".86"/>
  ${lettering}
</svg>`;

	const png = await sharp(Buffer.from(artwork))
		.png({ compressionLevel: 9, palette: true, colours: 256 })
		.toBuffer();

	return new Response(new Uint8Array(png), {
		headers: { "Content-Type": "image/png" },
	});
};

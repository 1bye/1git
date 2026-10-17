import { Buffer } from "node:buffer";
import type { APIRoute } from "astro";
import sharp from "sharp";
import ribbon from "../../public/favicon.svg?raw";
import workspaceScreenshot from "../assets/1git-native-window.png?inline";

/** Render the social card at build time; sharing crawlers receive a static PNG. */
export const GET: APIRoute = async () => {
	const logo = Buffer.from(ribbon).toString("base64");

	const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="window"><rect x="72" y="79" width="1754" height="1152" rx="28"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#0e0e11"/>
  <image x="56" y="56" width="72" height="72" href="data:image/svg+xml;base64,${logo}"/>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
    <text x="141" y="108" fill="#f2f2f4" font-size="44" font-weight="600" letter-spacing="-1.4">1git</text>
    <text x="64" y="267" fill="#f2f2f4" font-size="57" font-weight="500" letter-spacing="-2.2">A clearer view.</text>
    <text x="64" y="331" fill="#adaeb8" font-size="57" font-weight="500" letter-spacing="-2.2">Of every change.</text>
    <text x="66" y="563" fill="#8e8e9c" font-size="19">git.1bye.dev</text>
  </g>
  <svg x="580" y="116" width="700" height="460" viewBox="72 79 1754 1152">
    <image width="1902" height="1312" href="${workspaceScreenshot}" clip-path="url(#window)"/>
  </svg>
</svg>`;

	const png = await sharp(Buffer.from(artwork)).png().toBuffer();

	return new Response(new Uint8Array(png), {
		headers: { "Content-Type": "image/png" },
	});
};

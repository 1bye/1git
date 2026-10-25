/** Validate real build output, including crawlable answers, schema and sharing assets. */
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import sharp from "sharp";

const output = new URL("../dist/", import.meta.url);
const origin = "https://git.1bye.dev";
const sitemap = await readFile(new URL("sitemap.xml", output), "utf8");
const robots = await readFile(new URL("robots.txt", output), "utf8");

assert.match(robots, /User-agent: \*\s+Allow: \//);
assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`));

for (const [file, path, indexable] of [
	["index.html", "/", true],
	["faq/index.html", "/faq/", true],
	["404.html", "/404", false],
] as const) {
	const html = await readFile(new URL(file, output), "utf8");
	const meta = new Map<string, string>();
	const icons: string[] = [];
	let canonical: string | null = null;
	let json = "";
	let title = "";
	let headings = 0;
	let answers = "";

	await new HTMLRewriter()
		.on("meta", {
			element(element) {
				const name =
					element.getAttribute("name") ?? element.getAttribute("property");

				if (name) meta.set(name, element.getAttribute("content") ?? "");
			},
		})
		.on('link[rel="canonical"]', {
			element(element) {
				canonical = element.getAttribute("href");
			},
		})
		.on('link[rel="icon"],link[rel="apple-touch-icon"]', {
			element(element) {
				icons.push(element.getAttribute("href") ?? "");
			},
		})
		.on('script[type="application/ld+json"]', {
			text(chunk) {
				json += chunk.text;
			},
		})
		.on("title", {
			text(chunk) {
				title += chunk.text;
			},
		})
		.on("h1", {
			element() {
				headings += 1;
			},
		})
		.on(".faq-answers", {
			text(chunk) {
				answers += chunk.text;
			},
		})
		.transform(new Response(html))
		.text();

	assert.equal(headings, 1, `${path}: one meaningful H1`);
	assert(title.includes("1git"));
	assert(meta.get("description"));
	assert.equal(meta.get("og:title"), title);
	assert.equal(meta.get("twitter:title"), title);
	assert.equal(meta.get("og:description"), meta.get("description"));
	assert.equal(meta.get("twitter:card"), "summary_large_image");
	assert.equal(meta.get("og:image"), `${origin}/og.png`);
	assert.equal(meta.get("og:image:secure_url"), meta.get("og:image"));
	assert.equal(meta.get("twitter:image"), meta.get("og:image"));
	assert.equal(meta.get("og:image:width"), "1200");
	assert.equal(meta.get("og:image:height"), "630");
	assert(meta.get("og:image:alt"));

	for (const icon of icons) await access(new URL(icon.slice(1), output));

	if (!indexable) {
		assert.equal(canonical, null);
		assert.equal(json, "");
		assert(meta.get("robots")?.includes("noindex"));
		continue;
	}

	assert.equal(canonical, `${origin}${path}`);
	assert.equal(meta.get("og:url"), canonical);
	assert(meta.get("robots")?.startsWith("index, follow"));
	assert(sitemap.includes(`<loc>${canonical}</loc>`));
	assert(
		!html.includes("http://localhost") && !html.includes("http://127.0.0.1")
	);

	const data: unknown = JSON.parse(json);

	assert(typeof data === "object" && data !== null && "@graph" in data);
	const nodes: unknown = data["@graph"];

	assert(Array.isArray(nodes));
	const graph = nodes.filter(
		(node): node is Record<string, unknown> =>
			typeof node === "object" && node !== null
	);

	assert.equal(graph.length, nodes.length);
	assert(graph.some((node) => node["@type"] === "WebSite"));
	assert(graph.some((node) => node["@type"] === "Person"));

	if (path === "/") {
		const app = graph.find((node) => node["@type"] === "SoftwareApplication");

		assert(app);
		assert.equal(app.downloadUrl, `${origin}/download`);
		assert.equal(app.operatingSystem, "macOS 13 or later");
		assert.equal(app.processorRequirements, "Apple Silicon");
		assert.equal(typeof app.screenshot, "string");
		await access(
			new URL(new URL(String(app.screenshot)).pathname.slice(1), output)
		);
	} else {
		const faq = graph.find((node) => node["@type"] === "FAQPage");

		assert(faq && Array.isArray(faq.mainEntity));
		const visible = answers.replaceAll("&#39;", "'").replaceAll("&amp;", "&");

		assert(faq.mainEntity.length > 0);

		for (const question of faq.mainEntity as unknown[]) {
			assert(typeof question === "object" && question !== null);
			assert("name" in question && typeof question.name === "string");
			assert("acceptedAnswer" in question);
			const answer = question.acceptedAnswer;

			assert(typeof answer === "object" && answer !== null && "text" in answer);
			assert(typeof answer.text === "string");
			assert(
				visible.includes(question.name),
				"FAQ question must be in visible HTML"
			);
			assert(
				visible.includes(answer.text),
				"FAQ answer must match visible copy"
			);
		}
	}
}

const image = await sharp(new URL("og.png", output).pathname).metadata();

assert.equal(image.format, "png");
assert.equal(image.width, 1200);
assert.equal(image.height, 630);
assert(!image.hasAlpha, "Sharing image must be opaque");

const windowCrop = await sharp(new URL("og.png", output).pathname)
	.extract({ left: 700, top: 170, width: 200, height: 160 })
	.toBuffer();

const windowStats = await sharp(windowCrop).stats();

assert(
	windowStats.channels.slice(0, 3).every((channel) => channel.mean < 85),
	"OG card must include the dark application window"
);
console.info(
	"SEO checks passed: metadata, schema, visible FAQ, sitemap, robots, icons and OG image."
);

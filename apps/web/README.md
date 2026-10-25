# 1git website

An Astro marketing site styled after the 1git launch film: a grained blue glow,
self-hosted Instrument Serif Italic and Inter, a native window hero, and small
vanilla TypeScript demonstrations. Existing download routing, FAQ answers,
canonical/OG tags, and structured data stay intact. No Git, SSH, account, or AI
operations run in the public page.

The canvas uses the film's elliptical shader and 12 Hz grain seed, caps DPR at
1.5 and rendering at 30 fps, and stops animating when the hero is offscreen or
the document is hidden. Reduced motion and WebGL failure use a CSS gradient and
static SVG noise. A blue shade behind content and backed frosted pills maintain
small-copy contrast; the pale hero edge carries no body copy.

`motion.ts` owns the shared easing constants and once-on-view behavior.
`launch-features.ts` owns the local AI, theme wallpaper and reading-spotlight
demonstrations. Pause motion stops autoplay; reduced motion skips the intro,
settles text immediately and disables autoplay. The optional intro runs once per
session, can be skipped or dismissed with Escape/Tab, and never makes the hero
content depend on JavaScript.

The hero floats the existing native Stashes screenshot without the MacBook frame. A
dedicated Changes capture is still needed. Its
lower visible area uses masked duplicate image layers with progressively stronger
blur. Masks and filters are on separate elements for Safari. Every copy uses the
same responsive image URLs, so no extra image downloads are introduced. The
full-size source remains linked. Existing MacBook assets and their provenance
are retained for historical reference but are no longer used by the page.

See [PR_DESCRIPTION.md](PR_DESCRIPTION.md) for copy decisions, open asset needs,
and review evidence.

## Development

From the repository root:

```sh
bun install
bun run dev:web
bun run build:web
```

From this folder:

```sh
bun run check-types
bun run test
bun run build
bun run preview
```

Astro generates static HTML and small browser scripts in `dist/`. No React,
database, application accounts, or server rendering are needed. `tsconfig.json`
selects browser types; `tsconfig.infra.json` checks the Bun deployment config,
Cloudflare handler and offline routing tests separately.

## Alchemy and Cloudflare

The website uses its own `1git-website` stack and Cloudflare deployment state,
following Taada's infrastructure pattern. Alchemy and Effect match the versions
already used by 1git's release infrastructure. Scripts use the existing
`personal` Alchemy profile, with credentials outside the repository.

```sh
bun run deploy:preview
bun run plan
bun run deploy
```

Every command builds Astro before Alchemy reads `dist/`. Preview has a separate
Workers URL and no production route. Production installs a `git.1bye.dev/*`
route in front of the existing Downloads Worker's custom domain; it does not
replace that domain, edit the release stack, or manage its R2 bucket/publisher.

Cloudflare serves the static files directly. Only `/download`, `/appcast.xml`,
and valid versioned release archives pass through the small edge handler to the
existing custom-domain origin. Redirects, response headers and streamed archive
bodies are preserved, while browser cookies and authorization are not forwarded.
Cloudflare route subrequests bypass the route and reach its custom-domain origin,
so the pass-through does not recurse. See [Cloudflare route precedence](https://developers.cloudflare.com/workers/configuration/routing/routes/#background).

The custom domain must remain attached to the release Worker. Do not move it to
this stack: installed apps and the website rely on that origin. Production route
behavior still needs verification after the first actual deployment; offline
tests substitute the Cloudflare assets binding and the release origin.

## Search and sharing

`Layout.astro` supplies canonical production URLs, page descriptions, Open Graph
and X large-image cards, and JSON-LD. The home page describes the actual macOS
application with `SoftwareApplication`; no price, rating, or benchmark is invented.
The linked `/faq/` page keeps factual answers visible in static HTML and derives
its `FAQPage` markup from that same content. This is descriptive markup, not a
promise of a search rich result or an AI citation. Keep answers aligned with the
native app when capabilities change.

`public/sitemap.xml` lists the two indexable pages; add new public content pages
there when needed. `robots.txt` allows crawling and advertises that sitemap. The
404 page is `noindex` and has no canonical or structured data. No special AI-only
content or crawler-specific rendering is used. Search Console and Bing Webmaster
Tools verification and sitemap submission happen separately after deployment.

`src/pages/og.png.ts` renders a 1200 × 630 PNG during `astro build`, using the
existing ribbon logo and native app screenshot. Its existing framing is preserved. It
needs no runtime image service or extra dependency. Preview `/og.png` locally
after a build, and check image dimensions, metadata URLs and FAQ answers before
publishing. PNG is used for broad sharing-crawler compatibility.

References: [Google's AI search guidance](https://developers.google.com/search/docs/appearance/ai-features),
[SoftwareApplication](https://schema.org/SoftwareApplication), and
[Open Graph](https://ogp.me/).

## Assets

The responsive cloud WebPs and optimized MacBook bezel come from the user's
Taada website. The 1git ribbon is copied from
`docs/branding/macos-icon/Ribbon-Final.svg`. Apple bezel provenance and usage
references are retained in `assets/macbook-source.json`. No original large
photographs, PSDs, DMGs, or source image packs are shipped.

`src/assets/1git-native-window.png` is the user's supplied native screenshot
(`SCR-20261017-ofhm.png`, stored at 2324 × 1602). The window bounds
(72, 79, 1754, 1152), measured in a 1902 × 1312 reference, were scaled to the
source image and extracted into `src/assets/launch/native-window.webp` (2143 × 1407).
The capture shows Stashes. The crop preserves the real traffic lights, glass,
grain and border.
Repository tabs and file names in the screenshot remain visible. No window
chrome is recreated in HTML. To replace the screenshot, update the PNG and its
window bounds together; the build generates optimized responsive variants.

The film feature composition retains the thirteen existing feature claims.
Tabs, AI and SSH get focused native-CSS/SVG sequences; the smaller features move
into the History/Branches/Workspace reading grid. Any interactive controls in
those illustrations are local demonstrations. Real downloads still use the
existing production `/download` endpoint, including from local previews.

The theme section cycles the four supplied wallpapers while visible, with manual
selection stopping autoplay. It deliberately labels this as a wallpaper preview:
the existing native screenshot remains in its original theme until matching Rose,
Forest, Cosmic and Workshop window captures are supplied. `Open source` uses `#`
as explicitly requested until a public repository destination is confirmed.

Instrument Serif and Inter are Latin-subset WOFF2 files derived from the same OFL
fonts used in the film. Their licenses are in `public/licenses/`. Icons reuse the
existing local glyph set; `public/licenses/phosphor-icons.txt` is retained.
No runtime font provider or animation dependency is needed.

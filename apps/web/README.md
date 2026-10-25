# 1git website

Production on `git.1bye.dev` sends anonymous page views and download clicks to
PostHog EU by default. Every page has an **Anonymous analytics** checkbox.
Only preferences and event counters use localStorage; no cookies or persistent
identity are created. Local development and preview hosts stay offline. See
[analytics policy and spending limits](../../packages/analytics/README.md).

An Astro marketing site styled after the 1git launch film: a grained blue glow,
self-hosted Instrument Serif Italic and Inter, a native window hero, and small
vanilla TypeScript demonstrations. Existing download routing, FAQ answers,
canonical/OG tags, and structured data stay intact. No Git, SSH, account, or AI
operations run in the public page.

The canvas uses the film's elliptical shader and 12 Hz grain seed, caps DPR at
1.5 and rendering at 30 fps, and stops animating when the hero is offscreen or
hidden. Static grain and CSS gradients take over for offscreen, reduced-motion
and unavailable-WebGL states. The glow follows each section's centre and radius;
SSH has its own deep palette. Local text scrims protect white copy while leaving
lighter section edges visible.

`motion.ts` owns the shared easings and once-on-view behavior.
`scene-motion.ts` stages eight full-screen scenes with native CSS scroll snapping.
The content moves and settles while the snap targets stay fixed in the layout.
Desktop uses mandatory snapping; narrow or short screens use proximity snapping
and let tall scenes scroll naturally. Pause animations and reduced motion disable
snapping and settle every scene. No wheel interception or animation dependency is
needed. `scenes.css` holds the scene layout and transitions.
`launch-features.ts` owns the AI crop interaction, synchronized theme frames and
reading spotlight. The footer's Pause animations button persists its explicit
choice in localStorage, safely falling back when storage is blocked. Paused or
reduced-motion visits skip intro/autoplay and show settled, readable content.

The hero fills one screen and crops its window to the remaining viewport space.
Eight vertical gradient masks blend incremental blur strengths that combine up
to 30px over its lower portion, then feather into the following
section. The filters sit beside the window at full page width, so they soften the
blue glow and the window together, matching the film. Keep their parent unmasked
so Safari can sample both. Only the window's final edge fades; the blur extends
past it. Missing captures remain labelled placeholders under the same effect.

`src/assets/screens/README.md` lists the required native captures. Astro discovers
supplied WebP/PNG/AVIF files automatically. Missing files stay labelled rather
than reusing another app state. The four theme controls switch both matching
window and wallpaper frames; all four native theme captures are currently pending.
The Tabs illustration alone uses a body crop of the existing supplied Stashes
window with its exact tab strip rebuilt above it for motion.

The GitHub footer links to `https://github.com/1bye/1git` by default. Forks can
set `PUBLIC_REPO_URL` before building to point to their own repository.

See [PR_DESCRIPTION.md](PR_DESCRIPTION.md) for the ten item changes, acceptance
checklist, asset gaps and review evidence.

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

`src/assets/1git-native-window.png` is the user's supplied native Stashes
screenshot (`SCR-20261017-ofhm.png`, stored at 2324 × 1602). A cropped derivative
is retained under `src/assets/launch/`; its body-only crop and the film's 1bye
avatar support the accurate four-tab illustration. The original full image
continues to serve existing OG/structured-data assets. No unrelated feature
window uses it as a missing-state fallback.

The smaller features live in the History/Branches/Workspace reading grid, with
unique 24-unit icons and a once-only 380ms spotlight. The AI section is a local
busy/result crop preview with transparent, accessible hit areas; it makes no AI,
Git, account or SSH requests. Downloads still use the existing production
`/download` endpoint, including from local previews.

Instrument Serif and Inter are Latin-subset WOFF2 files derived from the same OFL
fonts used in the film. Their licenses are in `public/licenses/`. Icons reuse the
existing local glyph set; `public/licenses/phosphor-icons.txt` is retained.
No runtime font provider or animation dependency is needed.

## Search, AI discovery and sharing

The homepage and FAQ are static HTML with page-specific titles/descriptions,
production canonical URLs, Open Graph/Twitter metadata and linked JSON-LD for
WebSite, WebPage/FAQPage, SoftwareApplication, author and sharing image. FAQ
answers are visible text generated from the same content as their schema.
`robots.txt` permits crawlers; `sitemap.xml` lists only the two indexable pages.
The 404 stays `noindex` and is excluded from the sitemap.

`/og.png` is a static 1200×630 PNG using the launch film's serif lettering, blue
glow, clouds and Changes window. It needs no browser JS, installed fonts, or
remote image requests. Source artwork is documented in `src/assets/social/`.

Run `bun run check-seo` after changing copy, metadata or sharing artwork. It builds
and checks the actual output, including schema JSON, visible FAQ answers, local
image paths, favicon files, the OG image dimensions and application-window crop.

AI search uses the same crawlable, factual content and SEO foundations; no hidden
keyword blocks or special AI ranking markup are added. See [Google's AI search
guidance](https://developers.google.com/search/docs/appearance/ai-features) and
[Open Graph](https://ogp.me/). SoftwareApplication describes the app without
inventing reviews, ratings or prices to qualify for enhanced Google results.

These checks cover the local build. After deployment, verify public responses,
submit the sitemap in Search Console/Bing Webmaster Tools, and refresh cached
social previews. No indexing or ranking outcome is guaranteed by metadata.

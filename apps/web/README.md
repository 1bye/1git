# 1git website

An Astro landing page alongside the native app, adapted from Taada's cloudy
desktop and MacBook preview, with compact feature cards and a minimal footer.
The website always uses a dark palette, including the navigation and 404 page,
independently of the visitor's system appearance.
The app preview uses the user's native macOS screenshot, preserving the actual
window material and controls. Astro generates responsive WebP images, with a
link to the full-size original. The public page never connects to GitHub or SSH.

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
existing ribbon logo and native app screenshot, framed to the same window bounds
as the homepage. It
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

`src/assets/1git-native-window.png` is the user's supplied 1902 × 1312 screenshot
(`SCR-20261017-ofhm.png`). CSS frames its app window at (72, 79, 1754, 1152),
preserving the actual macOS traffic lights, glass, grain and window border.
Repository tabs and file names in the screenshot remain visible. No window
chrome is recreated in HTML. To replace the screenshot, update the PNG and its
window bounds together; the build generates optimized responsive variants.

The asymmetric bento grid illustrates thirteen existing capabilities in
`FeatureIllustration.astro`: GPU rendering, selected changes and commits,
branches/worktrees, spaces, repository tabs, commit history, GitHub/GitLab accounts
and GitHub CLI, SSH, AI commit drafts, ignored-file history, multiple stashes,
file-type editor preferences, and keyboard shortcuts. All cards use decorative SVG
artwork. Changes shows two selected rows and an unselected row; History shows a
commit list; Spaces groups repositories into Work and Personal contexts; Tabs
shows separate repository tabs. AI drafts remain editable, and ignored-file history
is opt-in for selected ignored paths. Provider glyphs reuse the app's Phosphor
Icons under the MIT license in `public/licenses/phosphor-icons.txt`. The renderer
claim reflects the app's GPUI/Metal renderer; no benchmark or frame-rate claim
is made. The keyboard artwork shows the app's Command+P repository picker.
The Diagram-inspired cards use a solid dark background without borders and
small, medium-weight titles. Artwork uses flat charcoal fills, softly blurred CSS edge lighting, small shadows
and muted functional accents. Editor logos are local assets: Xcode from
[Apple Developer](https://developer.apple.com/xcode/), VS Code from its
[official brand assets](https://code.visualstudio.com/brand), and Zed from the
installed app icon. The remaining artwork is SVG, without gradient fills.
Motion follows the artwork: the processor and SSH connection pulse slowly while
visible, and History highlights its rows once on entry. Hover draws selection
checks, traces a branch, separates spaces, switches a repository tab,
lifts provider tiles, types an AI draft, reveals stacked file versions, inserts a new
stash while the oldest slides out, traces editor mappings, or presses the shortcut
keys. The typing caret is a CSS border sized in the same monospace units as its
text, so it stays beyond the letters throughout the reveal. Touch screens get brief entry sequences
for the checks, branch, tabs, AI draft, file versions, stashes, editor routes and
keycaps.
On pointer exit, interrupted hover artwork eases from its current frame back to
rest over 420 ms. A quick re-entry finishes that return before replaying; tab
close buttons stay in their own slots throughout. Existing CSS transitions handle
space and provider tiles. Returns are cancelled when motion is paused, reduced,
hidden or offscreen, and touch entry sequences remain independent of hover.
An IntersectionObserver stops artwork offscreen. The pause button beside the
section title stops all artwork motion; hidden documents and reduced-motion
preferences also keep it still. The artwork is decorative and performs no Git,
account, or AI operations. The hero retains the original native screenshot.

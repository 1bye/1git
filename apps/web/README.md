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
small, medium-weight titles. Artwork uses flat charcoal fills, thin top-edge
highlights, small shadows and muted functional accents; there are no gradients
or raster illustrations in the bento.
The processor, branch path and keycaps play
one brief CSS animation when their cards enter view, then settle. A small
IntersectionObserver resets them offscreen; reduced-motion preferences keep
the artwork still. These are conceptual artwork, with no working controls,
account access, or external images. The hero retains the original native screenshot.

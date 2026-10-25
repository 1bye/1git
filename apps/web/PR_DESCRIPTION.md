# Match the 1git site to its launch film

The marketing page now uses the film's grained blue glow, white italic Instrument
Serif headlines, floating application windows and full-screen scene transitions.
The website's placeholder windows are replaced by matching still renders of the
editable launch-film UI, as requested by the owner.

## Visuals and motion

- Self-host Instrument Serif Italic and Inter. Use a reusable blue glow with
  fine animated grain, a static fallback, and cloud wisps around window edges.
- Keep the skippable, once-per-session glow intro; remove “Introducing”. The
  hero includes the wordmark, Download CTA and real rendered Changes window.
  Eight masked backdrop-blur layers progressively soften the lower window.
- Use native CSS snapping across eight scenes with incoming/outgoing content
  motion. Narrow or short screens use proximity snapping for long content.
  Reduced motion and the persisted pause control settle content and disable
  autoplay and snapping.
- Play the film’s native tab drag once in one cropped window, keeping tab and
  content proportions aligned. Show only a shallow Changes preview below the
  strip, with a final-state poster for reduced motion, pause and playback failure.
  The AI composer has matching result/busy renders, aligned sparkle/Stop/Commit
  controls, a short press, eight stars and two confirmation rings. These are
  local demonstrations; they do not invoke AI or perform Git operations.
- Draw the Remote connection lines once. Crossfade each of Rose, Forest, Cosmic
  and Workshop with its matching window and wallpaper. Preserve manual selection.
- Run the Even more reading spotlight once and settle every row to full white.
  Finish with the wordmark, tagline, Download CTA and existing footer links.

## Window assets

Nine state assets come from the film's existing OneGitChangesWindow component,
rendered with Altavinci Desktop MCP in a separate capture project. The film
source was not changed. Full windows are 1920×1261; AI close-ups are 1240×768.
All active window slots are populated. Astro supplies responsive WebP variants,
explicit image dimensions, eager hero loading and lazy loading below the fold.
The full-size image links remain available.

These are still renders of the owner-selected film UI, rather than live native
screenshots. The AI crops preserve identical bounds, and their hit areas are
calibrated to the captured controls. Source props and capture geometry are
recorded in `src/assets/screens/README.md`.

## Copy changes and open questions

- Use “Built with GPUIX (GPUI).” below Native speed; rename the SSH display title
  to “Remote”; remove the visible “Everything in its place.” title.
- Remove the hero description paragraph per browser comment.
- Remove the hero Explore CTA, Built for label, numbered feature labels, short
  AI disclaimer, SOON pills, footer URL and Open source pill per browser comments.
- Use “Compare branches” in place of “Compare & pull requests”. Pull requests and
  Issues remain under Coming soon.
- “File history. Across renames.” is requested wording that still needs final
  product-copy review. No new feature, metric or testimonial was invented.
- The GitHub footer uses the configured public repository at `https://github.com/1bye/1git`; forks can override `PUBLIC_REPO_URL`.

## Search and sharing

- Link WebSite, WebPage/FAQPage, SoftwareApplication, author and sharing-image
  entities. Match FAQ schema to its visible answers and app metadata to the
  current Changes capture. Keep canonical URLs, sitemap and crawl permissions.
- Replace the old dark sharing image with a static 1200×630 blue glow, cloud,
  outlined serif lettering and Changes window. Open Graph/Twitter use the same
  image, with dimensions, descriptive alt text and HTTPS URL.
- Use the approved serif/clouds favicon and iOS icon. Remove header app icons.
- Add `bun run check-seo` to build and validate metadata, schema, visible FAQ
  answers, sitemap, robots, image paths, favicon assets and the OG image itself.
- GEO follows [Google's AI search guidance](https://developers.google.com/search/docs/appearance/ai-features): readable, factual static HTML and ordinary SEO.
  No hidden keyword copy, invented ratings/prices or special AI ranking markup.
  Deployment, Search Console submission and social cache refresh remain external
  release steps; local validation is not a claim of indexing or rich results.

## Validation

- Astro reports 0 errors/warnings/hints; the production build and 18 existing
  tests pass. Targeted Oxlint/Oxfmt and diff
  whitespace checks pass. Existing SEO/OG data and download/FAQ routes remain.
- Chromium checks at 1440px, 390px and 360px show no missing window states or
  horizontal overflow. AI replay/Stop and both rings work; all four theme
  controls load their matching windows. Reduced motion leaves the hero loaded
  and disables snapping. Restarted the local Astro server after the newly added
  analytics workspace dependency left a stale resolver error in the preview.
- The cropped Tabs clip plays once, settles to its poster, stops offscreen and
  does not autoplay with reduced motion or a persisted pause. Checked at 1440px,
  390px and 360px with no overflow.
- Current capture/browser evidence is in `site-window-captures/proof/` in the
  chat artifacts. Capture sources and original PNGs are alongside that folder.
- Earlier Lighthouse baseline: mobile 97 Performance / 100 Accessibility,
  desktop 99 / 100. These measurements predate the final window assets and are
  not presented as a new audit. The current native Safari automation could not
  capture its window, so this asset pass is unverified there. Firefox and actual
  iOS Safari remain untested.

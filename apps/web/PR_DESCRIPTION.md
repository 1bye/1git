# Restyle the 1git website around the launch film

The marketing page now uses the film's grained blue glow, self-hosted Instrument
Serif Italic and Inter, floating native windows, and accelerating motion. The
MacBook composition and dark page theme are replaced by the film's visual system.
The existing feature claims, FAQ answers, production download endpoint, canonical
and OG tags, sitemap, and JSON-LD are retained. No deployment is included.

## Changes

- Add `GlowBackground`, `IntroSequence`, `Hero`, `FeatureBlock`, `ConnectionLines`,
  `ThemeCycler`, `EvenMoreGrid`, and `EndCard` Astro components.
- Add a skippable session intro, sparkle/tab/AI/SSH sequences, theme wallpaper
  controls, a once-only reading spotlight, and the settling end card.
- Keep animations in CSS and small vanilla TypeScript modules. The shader follows
  the supplied grain logic, with DPR capped at 1.5 and a 30 fps limit. Offscreen,
  hidden, paused, reduced-motion, and unavailable-WebGL states use static grain.
- Preserve real HTML text, skip navigation, visible focus, and a motion pause
  control. Small white copy uses a blue shade and backed frosted surfaces for
  contrast. The hero's masked image blur works in native Safari.
- Remove unused pre-restyle motion and illustration code. Keep original screenshot
  and MacBook provenance assets, routing infrastructure, and icon licensing.

## Copy decisions for review

Existing product claims and FAQ answers remain. These additions from the supplied
brief should be treated as proposed wording, rather than newly verified claims:

- “Introducinggggggg”, “Tabs”, “SSH”, “Make every repo yours.”, “Even more.”,
  “History”, “Branches”, “Workspace”, and “Every repository. One window.”
- “Compare branches” replaces “Compare & pull requests”. “Pull requests” and
  “Issues” appear only under “Coming soon”, with “SOON” badges. Confirm that this
  roadmap wording is ready to publish.
- “Open source” is added with `href="#"`, as explicitly requested. Supply the
  public repository URL when available; no destination has been guessed.
- Numbered section labels, “Explore 1git”, “Review the suggestion. Make it yours.”,
  “This Mac”, “Devbox”, and `ssh yurii@devbox` provide the film's presentation.
- Illustrative AI content uses the brief's `feat: add quick switcher`, example file
  names, and Reading / Reviewing / Writing statuses. Captions identify local
  demonstrations. Buttons do not send changes, generate AI requests, or commit.

## Open assets and browser checks

- A dedicated crisp Changes-window capture is still needed. The supplied native
  image shows Stashes; it is cropped without recreating window chrome and its alt
  text describes the actual image. A live native capture was attempted but the
  app window became unavailable, so no unrelated repository data was captured.
- Rose, Forest, Cosmic, and Workshop currently change the four supplied wallpapers.
  The app window stays in its original theme, explicitly stated in the caption.
  Matching native window captures are needed to complete the window crossfades.
- Confirm final wording above and replace the Open source placeholder when ready.
- Chromium and native macOS Safari were checked. Firefox and actual iOS Safari
  remain unverified; 390px/360px Chromium checks are responsive checks, not iOS tests.

## Validation

- `bun run check-types`: no errors, warnings, or hints.
- `bun run test`: 10 passing tests, including once-on-view/reduced-motion behavior
  and the existing download-routing tests.
- `bun run build`, targeted Oxlint, Oxfmt, and `git diff --check` pass.
- Checked 1440px, 390px, and reduced-motion 360px layouts, image loading, theme
  controls, header visibility, focusable download links, FAQ and 404 output.
- Production Lighthouse: mobile Performance **100**, Accessibility **100**, LCP
  **1.7s**; desktop Performance **99**, Accessibility **100**, LCP **0.4s**.
  These are local production-build measurements, not a deployed-site guarantee.
- Animation scripts total about **3.1 KB gzip**; fonts are self-hosted WOFF2 and
  below-fold screenshots are responsive lazy WebPs. No new runtime library.

## Review artifacts

Local evidence lives in:

`/Users/yuriihulyk/.codex/visualizations/2026/10/24/01a16f36-f098-78e2-90ba-a2fc9c41e4fd/site-review/`

- `before-1440.jpg`, `after-1440.jpg`, `before-390.jpg`, `after-390.jpg`
- `after-hero-1440.jpg`, `after-hero-390.jpg`, `after-grid-1440.jpg`
- `hero-and-spotlight.mp4` (final intro, hero entrance and grid spotlight)
- `safari-blur.png` (native macOS Safari blur check)
- `reduced-motion-360.jpg`
- `lighthouse-mobile.report.html` / `.json` and
  `lighthouse-desktop.report.html` / `.json`

Attach the review bundle when opening the PR. Large review recordings and reports
are intentionally kept outside the source tree.

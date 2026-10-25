# Fix the launch-film site pass

Keep the approved hero, intro, type, frosted header, SSH layout and end card.
Apply the ten requested corrections in ten commits. Routes, FAQ, SEO/OG metadata
and deployment configuration remain unchanged. No deployment is included.

## Full-screen scene scrolling

Following the requested full-screen snapping direction, make the hero, Native,
Tabs, AI, Remote, Themes, Even more and end card eight separate scenes. Use the
browser's CSS scroll snapping and a small viewport-centre controller, without
adding GSAP. Incoming content moves up and settles; outgoing content accelerates
away. The glow stays continuous and feature demonstrations still run once in view.
Only the inner content transforms, preserving stable snap positions.

Desktop stops at every scene. Narrow or short screens use proximity snapping so
long content remains readable. Reduced motion and the persisted pause control
disable snapping and show settled content. Correct glow observation to use
height-based pixel margins; percentage IntersectionObserver margins resolve from
width and missed sections at wide desktop sizes. No copy changes in this step.

Scene validation: 15 tests pass, Astro reports no errors/warnings/hints, and the
production build passes. Chromium checks cover all eight 1440px stops, reverse
keyboard/wheel input, 390px long scenes, 360px overflow, persisted pause and reduced
motion. Native macOS Safari forward/reverse snapping also passes. Actual iOS
Safari and Firefox remain untested. Current screenshot placeholders remain visible.
Local production Lighthouse scores are 97 Performance / 100 Accessibility on
mobile (LCP 1.8s), and 99 / 100 on desktop (LCP 0.4s). Browser scripts total about
4 KB gzip. These local measurements do not replace testing on a deployed origin.

Scene evidence is in `site-scenes-review/` beside the earlier review directory:
`scene-scrolling.mp4` records all eight stops; desktop/mobile screenshots and
native Safari captures document the layout.

## Latest browser cleanup

Remove the hero Explore button, the Built for label and all five numbered section
labels, the short AI note, both SOON badges, the footer URL and the Open source
pill. Keep the Coming soon heading/items and GitHub footer link.

Use “Built with GPUIX (GPUI).” below Native speed, remove the visible “Everything
in its place.” title and its layout wrapper, and rename the SSH display title to
“Remote”. A screen-reader-only Features heading preserves the section hierarchy.

## Hero gradient blur

Match the film’s progressive blur across both the window and blue background.
Eight vertically masked strengths ramp to 30px, with a soft tail below the window.
Remove the internal window-only bands and soften the next heading’s clipped glow
so the join has no rectangular boundary. Verified on the current placeholder in
Chromium desktop/375px and native macOS Safari; final native capture is still pending.

## Asset status

No requested captures were supplied in `src/assets/screens/`. Each missing state
uses a labelled placeholder, never an unrelated image. Add the files listed in
`src/assets/screens/README.md`; Astro discovers them at build time. Required:
changes, ai-composer, ai-composer-busy, home-machines, devbox-remote, theme-rose,
theme-forest, theme-cosmic, theme-workshop. tabs-strip is optional; history is
unused while History remains a grid row. All screenshot descriptions are specific
to the state and placement. The original Stashes image remains in unchanged SEO/OG assets. In item 6 its
body is cropped for the Tabs illustration, whose four rebuilt tabs match that
capture exactly; it is used nowhere else as a feature-window stand-in.

## Changes by requested item

1. Replace repeated feature windows with named capture slots and explicit missing
   states. Supplied captures use Astro Image, dimensions and lazy responsive WebP.

2. Cross-fade each wallpaper and its matching window slot together at 800ms;
   pause offscreen, preserve manual controls and the 22% tint. Removed the old
   wallpaper-only caption. The four missing captures are explicit placeholders.

3. Restore per-section elliptical glow geometry as the page scrolls, with a
   deep SSH palette (#2f58b6 → #5d80c4). Remove the page-wide blue shade; soft
   local text scrims protect white copy while leaving light section edges visible.

4. Crop the hero to roughly 58% of the native window. Full-width sibling blur
   layers soften the window and background together through eight vertical masks
   up to 30px, with a feathered tail into the following section. Changes remains
   a labelled placeholder until its native capture is supplied.

5. Apply the brief’s Native-speed and Tabs sublines, remove duplicate Review /
   Stage / Commit, all four developer captions, and the short AI note.
   Move Pause animations into the footer and persist its explicit choice safely
   in localStorage. A saved pause skips intro/autoplay and shows settled content.

6. Replace the fake strip with the capture’s four exact repository/branch tabs,
   avatars and badges on a native body crop. Reorder with the app’s 240ms easing,
   centre Taaaaaaabs, and fit its full word below 768px. The existing capture is
   appropriate here because the feature demonstrates those actual tabs.

7. Start the grid at 64% white, then light rows once in DOM reading order every
   380ms. Each row has a unique meaningful icon and a draw, pop or slide action.
   Fold CLI sign-in into accounts, add the requested file-history/renames row,
   and give Pull requests / Issues their own tiles with individually timed entries.
   File history across renames is brief-supplied copy and still needs product
   wording review; it was not present in the previous marketing copy.

8. The GitHub footer link uses REPO_URL from PUBLIC_REPO_URL, with noopener
   and an external arrow. Its destination is labelled pending and disabled until
   the owner supplies the URL. The Open source pill is removed.

9. Keep the real app icon and set its neighbouring header wordmark in Instrument
   Serif Italic, at icon height on desktop and mobile.

10. Replace the bare AI card with matching busy/result crop slots and transparent,
   labelled sparkle / Stop / Commit hit areas. Busy lasts 1.2 seconds; stop and
   motion preferences settle it. Eight stars and two rings keep the interaction.
   Native crops are absent, so these remain clearly labelled placeholders.

## Acceptance checklist

- ✔ No screenshot is used more than twice on the page; all current image alts are
  unique and specific. The Changes slot is used twice with placement-specific
  descriptions. Missing states remain labelled rather than substituted.
- ✘ The window visibly re-themes in all four themes — the paired crossfade works,
  but `theme-rose.webp`, `theme-forest.webp`, `theme-cosmic.webp` and
  `theme-workshop.webp` have not been supplied.
- ✔ Section edges visibly lighten, SSH has the deep palette, and local scrims
  preserve AA contrast. 47 sampled text-background lines at 1440px/375px passed;
  the lowest measured ratio was 4.80:1. Future native captures need their own check.
- ✘ The actual hero Changes screenshot is pending. Its ~58% crop, fade and eight
  full-width progressive backdrop-filter layers are implemented. Native macOS Safari passed
  an isolated blur diagnostic; final native-image appearance remains unverified.
- ✔ All four developer captions are gone. Native/Tabs sublines match item 5; the
  short AI note is also removed following the latest browser comments.
- ✔ One tab strip, exact supplied repository labels/avatars/badges, 240ms app
  easing, centred word, and no 375px overflow. The word fits within x=90..285px.
- ✔ Spotlight runs once, starts at 64% white, advances every 380ms, and settles
  all ten rows. Ten distinct row icons and two distinct Coming soon icons.
- ✔ GitHub uses REPO_URL and is clearly flagged pending; the Open source pill
  is removed following the latest browser comments.
  Set PUBLIC_REPO_URL to the owner-supplied URL; no destination was guessed.
- ✔ Reduced motion skips intro/autoplay and leaves all ten rows white. Saved
  Pause animations survives reload, also skips intro, and settles content.
- ✔ Result screenshots at 1440px and 375px, plus a recording covering hero/intro,
  tabs, AI and Even more. Native captures remain visibly pending in that evidence.

## Validation and open questions

- Astro type check: 0 errors/warnings/hints. 15 tests pass, including blocked
  storage, pause/resume persistence, once-only entry, and existing routing cases.
- Production build, targeted Oxlint/Oxfmt and `git diff --check` pass. Existing
  SEO/OG/canonical tags, JSON-LD, FAQ copy and routing infrastructure are unchanged.
- Production Lighthouse: mobile Performance 97 / Accessibility 100, LCP 1.8s;
  desktop Performance 99 / Accessibility 100, LCP 0.4s. Local measurements only.
- Browser animation scripts total about 4 KB gzip, with no new dependency.
- Checked Chromium at both requested widths, native macOS Safari blur, AI Stop,
  eight-star burst/two rings, paired autoplay/manual theme selection, pause after
  reload, reduced motion and horizontal overflow. Firefox and actual iOS Safari
  were not tested.
- Supply the nine required captures listed above. AI crops must share bounds;
  check/calibrate their transparent hit areas against the final pixels. See
  `src/assets/screens/README.md` for expected capture geometry.
- Supply the public repository URL. “File history. Across renames.” is requested
  new copy and still needs product wording review; no broader capability was
  inferred. No deployment or remote PR was created.

## Review evidence

Local directory:

`/Users/yuriihulyk/.codex/visualizations/2026/10/24/01a16f36-f098-78e2-90ba-a2fc9c41e4fd/site-fix-review/`

Open `index.html` or attach `1git-fix-review.zip` when opening the PR. Includes
`hero-1440.jpg`, `hero-375.jpg`, `page-1440.jpg`, `page-375.jpg`, per-section
screenshots, `hero-tabs-ai-grid.mp4`, `safari-blur-diagnostic.png`,
`reduced-motion-375.jpg`, `contrast-report.json`, and both Lighthouse HTML/JSON
reports. The diagnostic contains test stripes, not a substitute app screenshot.

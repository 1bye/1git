# Fix the launch-film site pass

Keep the approved hero, intro, type, frosted header, SSH layout and end card.
Apply the ten requested corrections in ten commits. Routes, FAQ, SEO/OG metadata
and deployment configuration remain unchanged. No deployment is included.

## Asset status

No requested captures were supplied in `src/assets/screens/`. Each missing state
uses a labelled placeholder, never an unrelated image. Add the files listed in
`src/assets/screens/README.md`; Astro discovers them at build time. Required:
changes, ai-composer, ai-composer-busy, home-machines, devbox-remote, theme-rose,
theme-forest, theme-cosmic, theme-workshop. tabs-strip is optional; history is
unused while History remains a grid row. All screenshot descriptions are specific
to the state and placement. The original Stashes image remains only in unchanged
SEO/OG assets, not as a feature-window stand-in.

## Changes by requested item

1. Replace repeated feature windows with named capture slots and explicit missing
   states. Supplied captures use Astro Image, dimensions and lazy responsive WebP.

## Acceptance checklist

- ✘ No screenshot used more than twice; every alt unique and specific — named slots
  are ready, but the required native files are missing.
- ✘ All four themes visibly re-theme the window — pending captures.
- ✘ Section glow edges and deeper SSH world; AA edge contrast — pending validation.
- ✘ Cropped hero with Safari progressive blur — pending validation with capture.
- ✘ Developer captions removed and corrected copy — pending item 5.
- ✘ One tab strip, app easing, no overflow at 375px — pending item 6.
- ✘ Once-only spotlight, unique icons and Coming soon icons — pending item 7.
- ✘ Repository links use REPO_URL or are flagged pending — pending item 8.
- ✘ Reduced motion settles all content — pending final verification.
- ✘ 1440px/375px screenshots and hero/tabs/AI/grid recording — pending evidence.

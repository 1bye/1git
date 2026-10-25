# Native state captures

Place tight 2× native window captures here as WebP (PNG/AVIF also accepted).
The build discovers these files automatically. No unrelated screenshot is used
as a fallback: missing states render a labelled placeholder.

Required: changes.webp, ai-composer.webp, ai-composer-busy.webp,
home-machines.webp, devbox-remote.webp, theme-rose.webp, theme-forest.webp,
theme-cosmic.webp, theme-workshop.webp.

Optional: tabs-strip.webp, history.webp (only needed for a future History block).

Changes must include checked files, a README diff and composer. AI crops share
identical bounds: sparkle at 69% / 84%, Commit at 86% / 84% of the crop; adjust
the CSS hit areas if the actual crop uses different positions. Result message:
`feat: polish repository workspace`, with only `feat` green. The busy crop shows
Stop and Writing message… . Theme captures must use matching window geometry.

Tabs uses a body-only crop of the existing native screenshot, plus the film’s
1bye avatar. Its exact four-tab strip is rebuilt above that crop so it can move.
The original strip is removed from the body image; no second strip is present.

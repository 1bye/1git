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

4. Crop the hero to roughly 58% of the native window, with five independently
   masked backdrop-blur bands and a fade into the background. The filter wrapper
   is unmasked so Safari can sample the image. Changes remains a labelled
   placeholder until its native capture is supplied.

5. Apply the brief’s Native-speed and Tabs sublines, remove duplicate Review /
   Stage / Commit and all four developer captions, and keep the short AI note.
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

8. Both repository affordances share REPO_URL from PUBLIC_REPO_URL, with noopener
   and an external arrow. The owner has not supplied a destination: both are
   labelled URL pending and disabled rather than guessing a link or navigating to #.

## Acceptance checklist

- ✘ No screenshot used more than twice; every alt unique and specific — named slots
  are ready, but the required native files are missing.
- ✘ All four themes visibly re-theme the window — pending captures.
- ✘ Section glow edges and deeper SSH world; AA edge contrast — pending validation.
- ✘ Cropped hero with Safari progressive blur — pending validation with capture.
- ✘ Developer captions removed and corrected copy — pending item 5.
- ✘ One tab strip, app easing, no overflow at 375px — pending item 6.
- ✘ Once-only spotlight, unique icons and Coming soon icons — pending item 7.
- ✔ Open source and GitHub share REPO_URL and are explicitly pending until
  PUBLIC_REPO_URL is supplied.
- ✘ Reduced motion settles all content — pending final verification.
- ✘ 1440px/375px screenshots and hero/tabs/AI/grid recording — pending evidence.

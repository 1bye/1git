# 1git website

Astro 7.3.5 static pages with browser TypeScript, Bun workspace scripts, and
Alchemy 2.0.0-beta.83 / Effect 4.0.4 for Cloudflare deployment. Follow the root
TypeScript and workspace workflow; React instructions do not apply to Astro.

- Browser entry points: `src/pages/`, `src/scripts/`, and `src/styles/`.
- Edge entry point: `infra/worker.ts`; runs on Cloudflare, not Bun. No secrets,
  account access, uploads, or real Git operations belong in the public page.
- Deployment entry point: `alchemy.run.ts`; runs on Bun. Keep deployment out of
  normal build/type/test tasks. Preserve the release stack's resources and URLs.
- Check: `bun run check-types`, `bun run test`, `bun run build` in this folder.
  Root Oxlint/Oxfmt cover supported source files; `astro check` checks `.astro`.
- Browser checks: desktop and 390px width; header hidden and inert on the hero,
  animated floating header past it and on returning, screenshot proportions, full-size
  image link, download links, custom 404, reduced motion and no page overflow.
  The app screenshot is a static image supplied by the user. The native window
  crop and masked blur layers share optimized responsive assets. Test shader
  fallback, the skippable session intro, motion pause, and the reading spotlight.
  Window states resolve from `src/assets/screens/`; missing files must remain
  labelled placeholders. Theme windows and wallpapers crossfade together. Verify
  persisted Pause animations, the single native-matching tab strip, and both AI
  states. Never fill a missing state with an unrelated screenshot.

Cloud and bezel assets come from the user's Taada website; the app screenshot
comes from the user's native macOS window capture. Retain the
MacBook provenance in `assets/macbook-source.json` when changing its image.

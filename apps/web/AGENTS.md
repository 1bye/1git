# 1git website

Astro 7.3.5 static pages with browser TypeScript, Bun workspace scripts, and
Alchemy 2.0.0-beta.83 / Effect 4.0.4 for Cloudflare deployment. Follow the root
TypeScript and workspace workflow; React instructions do not apply to Astro.

- Browser entry points: `src/pages/`, `src/scripts/`, and `src/styles/`.
- Edge entry point: `infra/worker.ts`; runs on Cloudflare, not Bun. No secrets,
  account access, uploads, or real Git operations belong in the public demo.
- Deployment entry point: `alchemy.run.ts`; runs on Bun. Keep deployment out of
  normal build/type/test tasks. Preserve the release stack's resources and URLs.
- Check: `bun run check-types`, `bun run test`, `bun run build` in this folder.
  Root Oxlint/Oxfmt cover supported source files; `astro check` checks `.astro`.
- Browser checks: desktop and 390px width; file/view tabs by mouse and keyboard,
  themes, machine selection, download links, custom 404, reduced motion and no
  page overflow. Preview content is illustrative and stays in page memory.

Public assets are copied from the user's Taada website and 1git branding. Retain
the MacBook provenance in `assets/macbook-source.json` when changing its image.

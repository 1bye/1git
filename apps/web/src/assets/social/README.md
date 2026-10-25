# Social sharing artwork

`lettering.svg` outlines the launch film's Instrument Serif Italic and Inter
lettering so `/og.png` renders identically in builds without installed fonts.
Both fonts are SIL OFL; notices are in `public/licenses/`. The text is:

- 1git
- A clearer view. / Of every change.
- Native Git client for macOS
- macOS 13+ · Apple Silicon · Git required
- git.1bye.dev

`src/pages/og.png.ts` composes these outlines with the site's Changes window,
blue glow, grain and cloud texture. It emits a static, opaque 1200×630 PNG for
Open Graph and Twitter cards. Update the layout's image alt text when changing
this composition. No remote assets or runtime font requests are needed.

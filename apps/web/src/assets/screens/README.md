# Launch-film window states

These WebP assets are still renders of the editable window chosen by the user
from `Git Client Intro/components/1git/OneGitChangesWindow.html`. They are not
live screenshots or a running Git client embedded in the page. The source UI,
fonts, repository data, colours and patterns come from the launch film.

Rendered through Altavinci Desktop MCP from film revision `50692644` in a
separate capture project. The film source was not edited. Working capture
artboards and original PNGs are in the chat's `site-window-captures/` artifact.

| Asset | Film window props |
| --- | --- |
| changes.webp | Default Changes state, ready=0 |
| ai-composer.webp | aiMessage=1, ready=1 |
| ai-composer-busy.webp | aiBusy=1, aiPhase=3, aiSpin=80 |
| home-machines.webp | home=1, machineState=3 |
| devbox-remote.webp | remote=1, ready=1, tabDrag=1, all three neighbour shifts=1 |
| theme-rose.webp | look=1, themedWallpaper=true |
| theme-forest.webp | look=2, themedWallpaper=true |
| theme-cosmic.webp | look=3, themedWallpaper=true |
| theme-workshop.webp | look=4, themedWallpaper=true |

Full windows are 1920×1261, rendered from the 1072×704 source at 1.791×.
The AI crops share 1240×768 bounds: source x=48, y=506, width=310, height=192,
rendered at 4×. Sparkle/Commit centres are approximately (55.5%,61%) and
(79.2%,61%); the busy state's Stop centre is (46.6%,61%). Keep the transparent
website controls aligned if replacing these crops. Only `feat` is tinted green.

The Tabs example uses `../launch/tab-drag.mp4` and its final-state WebP poster.
Altavinci MCP rendered the native tab movement and neighbour shifts as one
1280×360 close-up (640×180 source pixels at 2×). Its camera follows the drag,
showing only the top of Changes beneath the strip at the same UI scale. It plays
once in view; reduced motion, pause, failed playback and completion show the
poster. The older `tabs-body-film.webp`, Stashes crop and avatar are historical
assets and are no longer used by TabStrip.

Astro discovers named state assets automatically and generates responsive WebP
variants. Keep explicit dimensions, lazy loading below the hero, and labelled
placeholders for any future missing state. Never substitute an unrelated image.
`tabs-strip` and `history` are optional slots and are not used by the current page.

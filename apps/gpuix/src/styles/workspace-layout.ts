import { workspaceLayout as sharedLayout } from "@1git/design-tokens";

const tabContentInsetTop = 4;
const tabHeight =
  tabContentInsetTop +
  sharedLayout.tabCloseSize +
  sharedLayout.tabContentInsetBlock;

/** Native chrome spacing; keep the shared bottom inset, hit targets, and window-edge gap. */
export const workspaceLayout = {
  ...sharedLayout,
  // Leave more breathing room between the traffic lights and the first tab.
  desktopTitlebarControlsWidth: 96,
  // Paint room outside each tab slot for the connected surface's curved shoulders.
  tabSurfaceOutset: 10,
  tabContentInsetTop,
  tabHeight,
  toolbarHeight:
    sharedLayout.toolbarHeight - sharedLayout.tabHeight + tabHeight,
} as const;

import { spacing, workspaceLayout as sharedLayout } from "@1git/design-tokens";

const tabContentInsetTop = spacing[1];

const tabHeight =
	tabContentInsetTop +
	sharedLayout.tabCloseSize +
	sharedLayout.tabContentInsetBlock;

/** Native chrome spacing; keep the shared bottom inset, hit targets, and window-edge gap. */
export const workspaceLayout = {
	...sharedLayout,
	// The traffic lights end at 76px; leave 10px before the Home control.
	desktopTitlebarControlsWidth: 86,
	// Paint room outside each tab slot for the connected surface's curved shoulders.
	tabSurfaceOutset: 10,
	tabContentInsetTop,
	tabHeight,
	toolbarHeight:
		sharedLayout.toolbarHeight - sharedLayout.tabHeight + tabHeight,
} as const;

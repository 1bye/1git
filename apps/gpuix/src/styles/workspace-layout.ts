import { workspaceLayout as sharedLayout } from "@1git/design-tokens";

const tabContentInsetTop = 4;
const tabHeight =
	tabContentInsetTop +
	sharedLayout.tabCloseSize +
	sharedLayout.tabContentInsetBlock;

/** Native-only upper spacing; keep the shared bottom inset, hit targets, and window-edge gap. */
export const workspaceLayout = {
	...sharedLayout,
	tabContentInsetTop,
	tabHeight,
	toolbarHeight:
		sharedLayout.toolbarHeight - sharedLayout.tabHeight + tabHeight,
} as const;

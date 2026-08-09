export const WORKSPACE_COMMAND_LENS_GROUP = "workspace-toolbar";

export const WORKSPACE_TAB_POINTER_DRAG_HANDLE_SELECTOR =
	"[data-workspace-tab-pointer-drag-handle]";

export const WORKSPACE_TAB_REORDER_MOTION = {
	duration: 240,
	easing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

export const WORKSPACE_TAB_SURFACE_MOTION = {
	durationMs: WORKSPACE_TAB_REORDER_MOTION.duration,
} as const;

/** Adjust the active tab and SDF fusion geometry from this single object. */
export const WORKSPACE_TAB_SURFACE_GEOMETRY = {
	blendRadius: 12,
	containerDepth: 48,
	containerInset: 6,
	containerOverlap: 1,
	containerRadius: 14,
	outlineWidth: 1,
	sampleCellSize: 2,
	smoothingPasses: 1,
	tabAvatarSize: 14,
	tabChangeBadgeHeight: 18,
	tabChangeBadgeMinWidth: 18,
	tabCloseSize: 24,
	tabContentGap: 8,
	tabContentInsetBlock: 8,
	tabContentInsetInlineStart: 12,
	tabGap: 0,
	tabHeight: 40,
	tabLift: 3,
	tabListInset: 4,
	tabRadius: 10,
	tabSdfEdgeExtensionBlockEnd: 3,
	tabSdfExtensionBlockEnd: 16,
	tabTrailingInset: 4,
	tabVisualInsetBlock: 4,
	tabVisualInsetInline: 4,
	tabWidth: 210,
	toolbarHeight: 46,
} as const;

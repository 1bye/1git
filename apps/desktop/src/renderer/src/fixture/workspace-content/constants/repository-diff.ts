import type { BaseDiffOptions } from "@pierre/diffs";

export const REPOSITORY_DIFF_ELEMENT_NAME = "diffs-container";

export const REPOSITORY_DIFF_RENDER_OPTIONS = {
	collapsedContextThreshold: 3,
	diffIndicators: "bars",
	diffStyle: "unified",
	disableFileHeader: true,
	expandUnchanged: false,
	expansionLineCount: 20,
	hunkSeparators: "line-info",
	lineDiffType: "word-alt",
	overflow: "scroll",
	theme: "github-light",
	themeType: "light",
	unsafeCSS: `
		:host {
			color-scheme: light;
			display: block;
			--diffs-addition-color-override: #22863a;
			--diffs-bg: #ffffff;
			--diffs-bg-addition-emphasis-override: #acf2bd;
			--diffs-bg-context-override: #f6f8fa;
			--diffs-bg-deletion-emphasis-override: #fdb8c0;
			--diffs-bg-separator-override: #f6f8fa;
			--diffs-deletion-color-override: #cb2431;
			--diffs-fg: #24292e;
			--diffs-fg-number-override: #444d56;
			--diffs-font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
			--diffs-font-size: 12px;
			--diffs-gap-block: 4px;
			--diffs-gap-inline: 4px;
			--diffs-light: #24292e;
			--diffs-light-bg: #ffffff;
			--diffs-line-height: 20px;
		}

		pre {
			font-family: var(--diffs-font-family) !important;
			font-size: var(--diffs-font-size) !important;
			line-height: var(--diffs-line-height) !important;
		}

		[data-line-type="change-addition"]:where(
			[data-line],
			[data-no-newline]
		) {
			--diffs-computed-diff-line-bg: #e6ffed;
			--diffs-computed-selected-line-bg: #e6ffed;
			--diffs-line-bg: #e6ffed;
		}

		[data-line-type="change-deletion"]:where(
			[data-line],
			[data-no-newline]
		) {
			--diffs-computed-diff-line-bg: #ffeef0;
			--diffs-computed-selected-line-bg: #ffeef0;
			--diffs-line-bg: #ffeef0;
		}

		[data-line-type="change-addition"]:where(
			[data-column-number],
			[data-gutter-buffer]
		) {
			--diffs-computed-diff-line-bg: #cdffd8;
			--diffs-computed-selected-line-bg: #cdffd8;
			--diffs-line-bg: #cdffd8;
			color: #444d56;
		}

		[data-line-type="change-deletion"]:where(
			[data-column-number],
			[data-gutter-buffer]
		) {
			--diffs-computed-diff-line-bg: #ffdce0;
			--diffs-computed-selected-line-bg: #ffdce0;
			--diffs-line-bg: #ffdce0;
			color: #444d56;
		}

		[data-line-type="change-addition"] [data-diff-span] {
			background-color: #acf2bd;
		}

		[data-line-type="change-deletion"] [data-diff-span] {
			background-color: #fdb8c0;
		}

		[data-indicators="bars"]
			[data-line-type="change-addition"][data-column-number]::before {
			background-color: #85e89d;
		}

		[data-indicators="bars"]
			[data-line-type="change-deletion"][data-column-number]::before {
			background-image: linear-gradient(
				0deg,
				#ffeef0 50%,
				#fdaeb7 50%
			);
		}

		[data-separator="line-info"] {
			height: 32px;
		}

		[data-separator="line-info"] [data-separator-content],
		[data-separator="line-info"] [data-expand-button] {
			background-color: #f6f8fa;
			color: #586069;
		}

		[data-separator="line-info"] [data-expand-button] {
			border-color: #ffffff;
		}

		[data-separator="line-info"] [data-separator-content]:hover,
		[data-separator="line-info"] [data-expand-button]:hover {
			background-color: #ebeef1;
			color: #24292e;
			text-decoration: none;
		}

		[data-unmodified-lines] {
			font-size: 12px;
		}
	`,
} as const satisfies BaseDiffOptions;

export const REPOSITORY_DIFF_VIRTUALIZER_CONFIG = {
	intersectionObserverMargin: 1600,
	overscrollSize: 800,
} as const;

export const REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT = 20;
export const REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT = 32;
export const REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT = 64;
export const REPOSITORY_DIFF_BODY_OBSERVER_MARGIN = 120;
export const REPOSITORY_DIFF_INITIAL_MOUNTED_COUNT = 1;
export const REPOSITORY_DIFF_EXPANDABLE_CONTEXT_LINES = 1_000_000;

// Native SVG masks, using the same light line weight as the app's controls.
const svg = (paths: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Shared native glyphs for the workspace rail and its Settings preview. */
export const workspaceRailIcons = {
	changes: svg(
		'<path d="M5 3v12m14-6v12M5 9h9l-3-3m3 3-3 3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="6" r="3"/>'
	),
	history: svg('<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l4 2"/>'),
	graph: svg(
		'<path d="M6 5v14M18 5v5a4 4 0 0 1-4 4H6"/><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/>'
	),
	stashes: svg(
		'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M9 12h6"/>'
	),
	settings: svg(
		'<path d="m9 3-.7 2.4-2 .9L4 5.6l-2 3.5 1.8 1.7v2.4L2 14.9l2 3.5 2.3-.7 2 .9L9 21h6l.7-2.4 2-.9 2.3.7 2-3.5-1.8-1.7v-2.4L22 9.1l-2-3.5-2.3.7-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/>'
	),
	account: svg(
		'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.5 18a6.5 6.5 0 0 1 13 0"/>'
	),
} as const;

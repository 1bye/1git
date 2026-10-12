/** Provider glyphs shared by the connection list and provider chooser. */
export const aiProviderIcons = {
	opencode:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/></svg>',
	chatgpt:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-7l-5 3v-3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="m13 6 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/></svg>',
};

export const aiProviderNames = {
	opencode: "OpenCode",
	chatgpt: "ChatGPT",
} as const;

/** App-drawn plan glyphs use the same light stroke as the provider tiles. */
export const opencodePlanIcons = {
	free: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12v9h14v-9M12 8v13"/><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8H8a2.5 2.5 0 1 1 2.5-2.5L12 8h4a2.5 2.5 0 1 0-2.5-2.5L12 8Z"/></svg>',
	go: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/></svg>',
	zen: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M19 8V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7m18 7h-4v3h4"/></svg>',
};

/** Provider glyphs shared by the connection list and provider chooser. */
export const aiProviderIcons = {
	api: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M15 6.5h3m-3 11h3"/></svg>',
	opencode:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/></svg>',
	chatgpt:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-7l-5 3v-3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="m13 6 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/></svg>',
	"claude-code":
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="m4 4 16 16M20 4 4 20M12 2v20M2 12h20M7 2l10 20M2 7l20 10M17 2 7 22M22 7 2 17"/></svg>',
	codex:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></svg>',
};

export const aiProviderNames = {
	api: "API",
	opencode: "OpenCode",
	chatgpt: "ChatGPT",
	"claude-code": "Claude Code",
	codex: "Codex CLI",
} as const;

/** App-drawn plan glyphs use the same light stroke as the provider tiles. */
export const opencodePlanIcons = {
	free: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12v9h14v-9M12 8v13"/><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8H8a2.5 2.5 0 1 1 2.5-2.5L12 8h4a2.5 2.5 0 1 0-2.5-2.5L12 8Z"/></svg>',
	go: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/></svg>',
	zen: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M19 8V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7m18 7h-4v3h4"/></svg>',
};

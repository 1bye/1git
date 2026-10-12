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

/** Shared outline presets for the space editor, rail, saved-session validation and native menu labels. */
export const spaceIconPresets = [
	{
		id: "layers",
		label: "Layers",
		symbol: "▱",
		paths: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
	},
	{
		id: "work",
		label: "Work",
		symbol: "▣",
		paths:
			'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>',
	},
	{
		id: "home",
		label: "Home",
		symbol: "⌂",
		paths: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z"/>',
	},
	{
		id: "code",
		label: "Code",
		symbol: "‹›",
		paths: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
	},
	{
		id: "folder",
		label: "Folder",
		symbol: "▰",
		paths: '<path d="M3 7V4h6l3 3h9v14H3Z"/>',
	},
	{
		id: "terminal",
		label: "Terminal",
		symbol: "›_",
		paths:
			'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
	},
	{
		id: "server",
		label: "Server",
		symbol: "▤",
		paths:
			'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M15 6.5h3M15 17.5h3"/>',
	},
	{
		id: "globe",
		label: "Globe",
		symbol: "◎",
		paths:
			'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
	},
	{
		id: "cloud",
		label: "Cloud",
		symbol: "☁︎",
		paths:
			'<path d="M7 19a5 5 0 0 1-1-9.9 6 6 0 0 1 11.6-1A5.5 5.5 0 0 1 18 19Z"/>',
	},
	{
		id: "bolt",
		label: "Bolt",
		symbol: "ϟ",
		paths: '<path d="m14 2-9 12h6l-1 8 9-12h-6Z"/>',
	},
	{
		id: "rocket",
		label: "Rocket",
		symbol: "↗",
		paths:
			'<path d="M9 15c-1-5 4-11 12-12 0 8-6 13-11 12Zm0-5H5l-3 5h6m6 1v4l-5 2v-6M6 18l-3 3"/><circle cx="16" cy="8" r="2"/>',
	},
	{
		id: "flask",
		label: "Science",
		symbol: "⚗︎",
		paths:
			'<path d="M9 3h6m-5 0v7l-6 9a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2l-6-9V3M7 15h10"/>',
	},
	{
		id: "palette",
		label: "Design",
		symbol: "◉",
		paths:
			'<path d="M21 11a9 9 0 1 0-9 10h1a2 2 0 0 0 1-3.7 1.6 1.6 0 0 1 .8-3H18a3 3 0 0 0 3-3.3Z"/><circle cx="7" cy="10" r=".8"/><circle cx="10" cy="6.5" r=".8"/><circle cx="15" cy="7" r=".8"/>',
	},
	{
		id: "book",
		label: "Book",
		symbol: "▥",
		paths:
			'<path d="M12 5v16M3 4c3-1 6 0 9 1 3-1 6-2 9-1v15c-3-1-6 0-9 2-3-2-6-3-9-2Z"/>',
	},
	{
		id: "bookmark",
		label: "Bookmark",
		symbol: "▯",
		paths: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
	},
	{
		id: "star",
		label: "Star",
		symbol: "☆",
		paths:
			'<path d="m12 2 3.1 6.3L22 9.4l-5 4.9 1.2 6.9L12 18l-6.2 3.2L7 14.3 2 9.4l6.9-1.1Z"/>',
	},
	{
		id: "heart",
		label: "Heart",
		symbol: "♡",
		paths:
			'<path d="M20.5 5.5a5.1 5.1 0 0 0-7.2 0L12 6.8l-1.3-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.5-8.3a5.1 5.1 0 0 0 0-7.2Z"/>',
	},
	{
		id: "coffee",
		label: "Coffee",
		symbol: "☕︎",
		paths:
			'<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Zm14 1h2a3 3 0 0 1 0 6h-2M6 2v2m4-2v2m4-2v2"/>',
	},
	{
		id: "music",
		label: "Music",
		symbol: "♪",
		paths:
			'<path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
	},
	{
		id: "headphones",
		label: "Headphones",
		symbol: "♬",
		paths:
			'<path d="M3 15v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="13" width="4" height="8" rx="2"/><rect x="17" y="13" width="4" height="8" rx="2"/>',
	},
	{
		id: "compass",
		label: "Compass",
		symbol: "◇",
		paths: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
	},
	{
		id: "leaf",
		label: "Leaf",
		symbol: "❧",
		paths: '<path d="M20 3C8 2 2 8 5 16c3 8 17 4 15-13ZM3 22 15 10"/>',
	},
	{
		id: "mountain",
		label: "Mountain",
		symbol: "△",
		paths: '<path d="m2 21 10-18 10 18ZM8 10l4 3 4-3"/>',
	},
	{
		id: "shield",
		label: "Shield",
		symbol: "⬡",
		paths: '<path d="m12 2 8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5Z"/>',
	},
] as const;

export const spaceIcons = spaceIconPresets.map((preset) => preset.id);

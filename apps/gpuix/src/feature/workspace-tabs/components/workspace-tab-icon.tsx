import { createThemedStyles, useAppTheme } from "../../../styles/theme";

import { StyleSheet } from "@1git/gpuix-stylesheet";

// Phosphor Icons 2.1.10, Light weight. See ../../../../LICENSES/Phosphor-Icons.txt.
const sources = {
	copy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></svg>',
	tabs: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M9 4v5"/></svg>',
	// App-drawn Settings glyphs share the light stroke of the workspace controls.
	contrast:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>',
	pencil:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16-1 5 5-1L21 7l-4-4Zm10-10 4 4M4 16l4 4"/></svg>',
	network:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v5M5 16v-3h14v3"/></svg>',
	palette:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11a9 9 0 1 0-9 10h2a2 2 0 0 0 1-3.7 2 2 0 0 1 1-3.7h2a3 3 0 0 0 3-2.6Z"/><circle cx="7" cy="9" r=".7"/><circle cx="11" cy="6" r=".7"/><circle cx="16" cy="8" r=".7"/><circle cx="6" cy="14" r=".7"/></svg>',
	idCard:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M4 16c0-4 8-4 8 0m3-6h4m-4 4h4"/></svg>',
	history:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4v5h5M3 9a9 9 0 1 1 0 6m9-9v6l4 2"/></svg>',

	// App-drawn keyboard follows the other Settings glyphs' light stroke.
	keyboard:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>',
	// App-drawn file-navigation glyphs share the existing light stroke.
	list: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01"/></svg>',
	tree: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2v10h3M2 6h3M7 2h7M7 6h7M7 12h7"/></svg>',
	folder:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2 4V3h4l2 2h6v8H2Z"/></svg>',
	// App-drawn layers matches the Spaces icon picker.
	layers:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>',
	// App-drawn shield uses the same light stroke as the other Settings icons.
	shield:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/></svg>',
	stop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
	// App-drawn sparkle uses the same light stroke as the compact workspace controls.
	sparkle:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m10 3 2.2 6.8L19 12l-6.8 2.2L10 21l-2.2-6.8L1 12l6.8-2.2Z"/><path d="m19 2 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/></svg>',
	home: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M217.9,110.1l-80-80a14,14,0,0,0-19.8,0l-80,80A13.92,13.92,0,0,0,34,120v96a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V158h36v58a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V120A13.92,13.92,0,0,0,217.9,110.1ZM210,210H158V152a6,6,0,0,0-6-6H104a6,6,0,0,0-6,6v58H46V120a2,2,0,0,1,.58-1.42l80-80a2,2,0,0,1,2.84,0l80,80A2,2,0,0,1,210,120Z"/></svg>',
	// App-drawn cloud upload glyph distinguishes first publication from a normal push.
	publish:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18H6a4 4 0 0 1-1-7.87A7 7 0 0 1 18 9a4.5 4.5 0 0 1 0 9h-1"/><path d="M12 21V11m-4 4 4-4 4 4"/></svg>',
	arrowLeft:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M222,128a6,6,0,0,1-6,6H54.49l61.75,61.76a6,6,0,1,1-8.48,8.48l-72-72a6,6,0,0,1,0-8.48l72-72a6,6,0,0,1,8.48,8.48L54.49,122H216A6,6,0,0,1,222,128Z"/></svg>',
	userCircle:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26ZM71.44,198a66,66,0,0,1,113.12,0,89.8,89.8,0,0,1-113.12,0ZM94,120a34,34,0,1,1,34,34A34,34,0,0,1,94,120Zm99.51,69.64a77.53,77.53,0,0,0-40-31.38,46,46,0,1,0-51,0,77.53,77.53,0,0,0-40,31.38,90,90,0,1,1,131,0Z"/></svg>',
	pull: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M204.24,148.24l-72,72a6,6,0,0,1-8.48,0l-72-72a6,6,0,0,1,8.48-8.48L122,201.51V40a6,6,0,0,1,12,0V201.51l61.76-61.75a6,6,0,0,1,8.48,8.48Z"/></svg>',
	push: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M204.24,116.24a6,6,0,0,1-8.48,0L134,54.49V216a6,6,0,0,1-12,0V54.49L60.24,116.24a6,6,0,0,1-8.48-8.48l72-72a6,6,0,0,1,8.48,0l72,72A6,6,0,0,1,204.24,116.24Z"/></svg>',
	sync: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M222,48V96a6,6,0,0,1-6,6H168a6,6,0,0,1,0-12h33.52L183.47,72a81.51,81.51,0,0,0-57.53-24h-.46A81.5,81.5,0,0,0,68.19,71.28a6,6,0,1,1-8.38-8.58,93.38,93.38,0,0,1,65.67-26.76H126a93.45,93.45,0,0,1,66,27.53l18,18V48a6,6,0,0,1,12,0ZM187.81,184.72a81.5,81.5,0,0,1-57.29,23.34h-.46a81.51,81.51,0,0,1-57.53-24L54.48,166H88a6,6,0,0,0,0-12H40a6,6,0,0,0-6,6v48a6,6,0,0,0,12,0V174.48l18,18.05a93.45,93.45,0,0,0,66,27.53h.52a93.38,93.38,0,0,0,65.67-26.76,6,6,0,1,0-8.38-8.58Z"/></svg>',
	close:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"/></svg>',
	add: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M222,128a6,6,0,0,1-6,6H134v82a6,6,0,0,1-12,0V134H40a6,6,0,0,1,0-12h82V40a6,6,0,0,1,12,0v82h82A6,6,0,0,1,222,128Z"/></svg>',
	branch:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M230,64a30,30,0,1,0-36,29.4V112a10,10,0,0,1-10,10H96a21.84,21.84,0,0,0-10,2.42v-31a30,30,0,1,0-12,0v69.2a30,30,0,1,0,12,0V144a10,10,0,0,1,10-10h88a22,22,0,0,0,22-22V93.4A30.05,30.05,0,0,0,230,64ZM62,64A18,18,0,1,1,80,82,18,18,0,0,1,62,64ZM98,192a18,18,0,1,1-18-18A18,18,0,0,1,98,192ZM200,82a18,18,0,1,1,18-18A18,18,0,0,1,200,82Z"/></svg>',
	check:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z"/></svg>',
	caretRight:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z"/></svg>',
	caretDown:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M212.24,100.24l-80,80a6,6,0,0,1-8.48,0l-80-80a6,6,0,0,1,8.48-8.48L128,167.51l75.76-75.75a6,6,0,0,1,8.48,8.48Z"/></svg>',
};

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		icon: {
			width: 14,
			height: 14,
			flexShrink: 0,
			color: appColors.editorMuted,
			pointerEvents: "none",
		},
	});

	return { styles };
});

/** The tab strip's Phosphor Light glyphs, rendered as native SVG masks. */
export function WorkspaceTabIcon({
	name,
	testId,
	color,
	size = 14,
}: {
	name: keyof typeof sources;
	testId?: string;
	color?: string;
	size?: number;
}) {
	const theme = useAppTheme();
	const { colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	return (
		<svg
			testId={testId}
			source={sources[name]}
			style={StyleSheet.compose(styles.icon, {
				color: color ?? appColors.editorMuted,
				width: size,
				height: size,
			})}
		/>
	);
}

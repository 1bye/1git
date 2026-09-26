import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

// Phosphor Icons 2.1.10, Light weight. See ../../../../LICENSES/Phosphor-Icons.txt.
const sources = {
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

const styles = StyleSheet.create({
	icon: {
		width: 14,
		height: 14,
		flexShrink: 0,
		color: lightColors.editorMuted,
		pointerEvents: "none",
	},
});

/** The tab strip's Phosphor Light glyphs, rendered as native SVG masks. */
export function WorkspaceTabIcon({
	name,
	testId,
	color = lightColors.editorMuted,
}: {
	name: keyof typeof sources;
	testId?: string;
	color?: string;
}) {
	return (
		<svg
			testId={testId}
			source={sources[name]}
			style={StyleSheet.compose(styles.icon, { color })}
		/>
	);
}

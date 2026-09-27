import { appTokens } from "../styles/tokens";

// Monochrome strokes use the same 256-unit, 8-unit thin weight as Phosphor Thin.
const sources = {
	direction:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M216 128H40m72-72-72 72 72 72"/></svg>',
	swap: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M40 80h176m-48-48 48 48-48 48M216 176H40m48-48-48 48 48 48"/></svg>',
	// Original branch-comparison illustration, drawn as vectors for crisp native scaling.
	empty:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 112" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M36 88V28m0 38c0-22 88 4 88-22V28"/><circle cx="36" cy="22" r="6"/><circle cx="124" cy="22" r="6"/><circle cx="36" cy="94" r="6"/><path d="M124 50v38" stroke-dasharray="3 5"/><circle cx="124" cy="94" r="6"/><path d="M64 87h32m-7-7 7 7-7 7M96 101H64m7-7-7 7 7 7"/></svg>',
};

/** Decorative native vector artwork; interactive parents provide accessible names. */
export function ComparisonArtwork({ name }: { name: keyof typeof sources }) {
	return (
		<svg
			testId={`comparison-art-${name}`}
			aria-hidden
			source={sources[name]}
			style={{
				width: name === "empty" ? 160 : 16,
				height: name === "empty" ? 112 : 16,
				flexShrink: 0,
				color: appTokens.colors.textMuted,
				pointerEvents: "none",
			}}
		/>
	);
}

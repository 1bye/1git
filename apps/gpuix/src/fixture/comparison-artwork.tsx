import { appTokens } from "../styles/tokens";
import { StateArtwork } from "./state-artwork";

// Monochrome strokes use the same 256-unit, 8-unit thin weight as Phosphor Thin.
const sources = {
	direction:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M216 128H40m72-72-72 72 72 72"/></svg>',
	swap: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M40 80h176m-48-48 48 48-48 48M216 176H40m48-48-48 48 48 48"/></svg>',
};

/** Decorative native vector artwork; interactive parents provide accessible names. */
export function ComparisonArtwork({
	name,
}: {
	name: keyof typeof sources | "empty";
}) {
	if (name === "empty")
		return <StateArtwork name="empty" testId="comparison-art-empty" />;

	return (
		<svg
			testId={`comparison-art-${name}`}
			aria-hidden
			source={sources[name]}
			style={{
				width: 16,
				height: 16,
				flexShrink: 0,
				color: appTokens.colors.textMuted,
				pointerEvents: "none",
			}}
		/>
	);
}

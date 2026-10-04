import { appTokens } from "../styles/tokens";

// Original drawings share a 160 × 112 canvas and one-point monochrome strokes.
function drawing(content: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 112" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

const sources = {
	empty: drawing(
		'<path d="M36 88V28m0 38c0-22 88 4 88-22V28"/><circle cx="36" cy="22" r="6"/><circle cx="124" cy="22" r="6"/><circle cx="36" cy="94" r="6"/><path d="M124 50v38" stroke-dasharray="3 5"/><circle cx="124" cy="94" r="6"/><path d="M64 87h32m-7-7 7 7-7 7M96 101H64m7-7-7 7 7 7"/>'
	),
	file: drawing(
		'<path d="M42 82H32a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6h10"/><path d="M96 8H52a6 6 0 0 0-6 6v78a6 6 0 0 0 6 6h50a6 6 0 0 0 6-6V20L96 8Zm0 0v12h12M60 34h32M60 46h22M60 58h28"/><path d="m94 66 32 15-14 4-5 14-13-33Z"/><path d="m114 88 9 12M14 48h12m96-18h20M132 20v20" stroke-dasharray="2 4"/>'
	),
	history: drawing(
		'<path d="M34 22v68"/><circle cx="34" cy="16" r="5"/><circle cx="34" cy="56" r="5"/><circle cx="34" cy="96" r="5"/><path d="M39 16h18m-18 40h18m-18 40h18" stroke-dasharray="2 4"/><rect x="58" y="6" width="76" height="22" rx="5"/><rect x="58" y="45" width="76" height="22" rx="5"/><rect x="58" y="84" width="76" height="22" rx="5"/><path d="M70 14h42m-42 7h24M70 53h34m-34 7h46M70 92h40m-40 7h20"/>'
	),
	stash: drawing(
		'<rect x="50" y="9" width="60" height="56" rx="5"/><path d="M40 43V26a5 5 0 0 1 5-5h5m60 0h5a5 5 0 0 1 5 5v17M63 23h34M63 34h24"/><rect x="30" y="47" width="100" height="14" rx="4"/><path d="M36 61v34a5 5 0 0 0 5 5h78a5 5 0 0 0 5-5V61"/><rect x="65" y="73" width="30" height="10" rx="3"/><path d="M18 81h10m104 0h10M74 109h12" stroke-dasharray="2 4"/>'
	),
	repository: drawing(
		'<path d="M22 38V28a6 6 0 0 1 6-6h34l12 12h56a6 6 0 0 1 6 6v50a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V38Z"/><path d="M22 46h114M63 62v18m0-9c0-8 34 3 34-9"/><circle cx="63" cy="58" r="4"/><circle cx="63" cy="84" r="4"/><circle cx="97" cy="58" r="4"/><path d="M10 60h6m126 0h8M72 12h14m-14 94h14" stroke-dasharray="2 4"/>'
	),
	search: drawing(
		'<path d="M32 90H24a5 5 0 0 1-5-5V30a5 5 0 0 1 5-5h8"/><path d="M83 11H43a6 6 0 0 0-6 6v71a6 6 0 0 0 6 6h31M83 11v14h15L83 11Zm15 14v22M51 39h32M51 51h22M51 63h16"/><circle cx="104" cy="73" r="21"/><path d="m120 89 17 17M94 73h20M112 15h20m-10-10v20" stroke-dasharray="2 4"/>'
	),
	loading: drawing(
		'<rect x="55" y="22" width="50" height="68" rx="6"/><path d="M68 38h24M68 48h16M69 63h22m-22 16h22M71 63c0 8 18 8 18 16M89 63c0 8-18 8-18 16"/><path d="M39 47a44 44 0 0 1 79-17m-1-15 1 15-15-1M121 65a44 44 0 0 1-79 17m1 15-1-15 15 1"/><path d="M31 60v6m98-20v6" stroke-dasharray="2 4"/>'
	),
	error: drawing(
		'<path d="M83 9H43a6 6 0 0 0-6 6v77a6 6 0 0 0 6 6h29M83 9v14h15L83 9Zm15 14v27M51 37h32M51 49h22M51 61h15"/><path d="m111 58 28 40a4 4 0 0 1-3 6H82a4 4 0 0 1-3-6l28-40a3 3 0 0 1 4 0ZM109 75v13m0 8v1"/><path d="m16 41 6 6m-6 0 6-6M118 22h16m-8-8v16"/>'
	),
	unavailable: drawing(
		'<path d="M93 10H49a6 6 0 0 0-6 6v78a6 6 0 0 0 6 6h56a6 6 0 0 0 6-6V28L93 10Zm0 0v18h18M56 40h14m-14 9h36M56 58h24"/><path d="m67 76-8 7 8 7m23-14 8 7-8 7m-13 2 5-18"/><path d="M20 49h16m-8-8v16M119 74h20m-15 21h8" stroke-dasharray="2 4"/>'
	),
	accounts: drawing(
		'<rect x="42" y="16" width="76" height="80" rx="10"/><circle cx="80" cy="43" r="10"/><path d="M62 70c0-10 8-17 18-17s18 7 18 17M66 82h28"/><rect x="10" y="36" width="20" height="40" rx="5"/><rect x="130" y="36" width="20" height="40" rx="5"/><path d="M30 56h12m76 0h12" stroke-dasharray="2 4"/><path d="M17 47h6m114 0h6M17 65h6m114 0h6M75 6h10m-10 100h10"/>'
	),
	clone: drawing(
		'<path d="M12 31V19a5 5 0 0 1 5-5h24l9 9h27a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V31ZM12 34h70"/><path d="M78 78V66a5 5 0 0 1 5-5h24l9 9h27a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H83a5 5 0 0 1-5-5V78ZM78 82h70"/><path d="M49 68v18h18m-7-7 7 7-7 7M93 39h20V25" stroke-dasharray="3 4"/>'
	),
};

/** Meaningful visual variants for app messages; labels remain in adjacent text. */
export type StateArtworkName = keyof typeof sources;

/** Decorative, crisp native vectors shared by empty, selection, loading and error states. */
export function StateArtwork({
	name,
	compact = false,
	testId = `state-art-${name}`,
}: {
	name: StateArtworkName;
	compact?: boolean;
	testId?: string;
}) {
	return (
		<svg
			testId={testId}
			aria-hidden
			source={sources[name]}
			style={{
				width: compact ? 80 : 160,
				height: compact ? 56 : 112,
				flexShrink: 0,
				color: appTokens.colors.textMuted,
				pointerEvents: "none",
			}}
		/>
	);
}

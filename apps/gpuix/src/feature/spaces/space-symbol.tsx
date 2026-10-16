import { useAppTheme } from "../../styles/theme";
import { iconSize, typography } from "@1git/design-tokens";

const paths: Record<string, string> = {
	layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
	work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>',
	home: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z"/>',
	code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
	folder: '<path d="M3 7V4h6l3 3h9v14H3Z"/>',
};

/** One built-in outline or user-selected emoji, shared by the rail and space editor. */
export function SpaceSymbol({ icon }: { icon: string }) {
	const { tokens } = useAppTheme();
	const path = paths[icon];

	return path ? (
		<svg
			source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`}
			style={{
				width: iconSize.lg,
				height: iconSize.lg,
				color: tokens.colors.textMuted,
				pointerEvents: "none",
			}}
		/>
	) : (
		<text style={{ ...typography.lg, pointerEvents: "none" }}>{icon}</text>
	);
}

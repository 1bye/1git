import { useAppTheme } from "../../styles/theme";
import { iconSize, typography } from "@1git/design-tokens";

import { spaceIconPresets } from "./space-icons";

/** Shared outline icons; older saved emoji choices remain renderable. */
export function SpaceSymbol({ icon, color }: { icon: string; color?: string }) {
	const { tokens } = useAppTheme();
	const path = spaceIconPresets.find((preset) => preset.id === icon)?.paths;

	return path ? (
		<svg
			source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`}
			style={{
				width: iconSize.lg,
				height: iconSize.lg,
				color: color ?? tokens.colors.textMuted,
				pointerEvents: "none",
			}}
		/>
	) : (
		<text style={{ ...typography.lg, pointerEvents: "none" }}>{icon}</text>
	);
}

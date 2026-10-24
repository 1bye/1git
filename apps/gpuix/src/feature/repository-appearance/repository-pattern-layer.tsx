import { useWindowSize } from "@gpuix/react";
import { useAppTheme } from "../../styles/theme";
import {
	repositoryPatternSources,
	repositoryPatternTileSize,
	repositoryPatternCornerSources,
	repositoryPatternCornerOffset,
} from "./pattern-artwork";
import type { RepositoryPattern } from "./repository-patterns";

/** Shared fixed-size masks behind chrome controls and opaque content. */
export function RepositoryPatternLayer({
	pattern,
}: {
	pattern: RepositoryPattern;
}) {
	const theme = useAppTheme();
	const { width, height } = useWindowSize();
	const columns = Math.max(1, Math.ceil(width / repositoryPatternTileSize));
	const rows = Math.max(1, Math.ceil(height / repositoryPatternTileSize));

	return (
		<div
			testId="repository-pattern-layer"
			aria-hidden
			style={{
				position: "absolute",
				top: -repositoryPatternCornerOffset,
				bottom: 0,
				left: 0,
				width: "100%",
				overflowX: "hidden",
				overflowY: "hidden",
				pointerEvents: "none",
			}}
		>
			{Array.from({ length: columns * rows }, (_, index) => (
				<svg
					key={index}
					testId={`repository-pattern-tile-${index}`}
					aria-hidden
					source={
						index === 0
							? repositoryPatternCornerSources[pattern]
							: repositoryPatternSources[pattern]
					}
					style={{
						position: "absolute",
						top:
							Math.floor(index / columns) * repositoryPatternTileSize +
							(index === 0 ? 0 : repositoryPatternCornerOffset),
						left: (index % columns) * repositoryPatternTileSize,
						width: repositoryPatternTileSize,
						height:
							repositoryPatternTileSize +
							(index === 0 ? repositoryPatternCornerOffset : 0),
						color: theme.colors.brand,
						opacity: theme.appearance === "dark" ? 0.24 : 0.18,
						pointerEvents: "none",
					}}
				/>
			))}
		</div>
	);
}

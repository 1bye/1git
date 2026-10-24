import { useWindowSize } from "@gpuix/react";
import { useMemo } from "react";
import { useAppTheme } from "../../styles/theme";
import {
	RepositoryPatternArtwork,
	repositoryPatternTileSize,
	repositoryPatternTileHeight,
	repositoryPatternCornerOffset,
} from "./pattern-artwork";
import type { RepositoryPattern } from "./repository-patterns";

/** Shared fixed-size masks behind chrome controls and opaque content. */
export function RepositoryPatternLayer({
	pattern,
	seed = 0,
}: {
	pattern: RepositoryPattern;
	seed?: number;
}) {
	const theme = useAppTheme();
	const { width, height } = useWindowSize();
	const columns = Math.max(1, Math.ceil(width / repositoryPatternTileSize));
	const rows = Math.max(1, Math.ceil(height / repositoryPatternTileHeight));

	const artwork = useMemo(
		() => RepositoryPatternArtwork.create(pattern, seed),
		[pattern, seed]
	);

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
					source={index === 0 ? artwork.cornerSource : artwork.source}
					style={{
						position: "absolute",
						top:
							Math.floor(index / columns) * repositoryPatternTileHeight +
							(index === 0 ? 0 : repositoryPatternCornerOffset),
						left: (index % columns) * repositoryPatternTileSize,
						width: repositoryPatternTileSize,
						height:
							repositoryPatternTileHeight +
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

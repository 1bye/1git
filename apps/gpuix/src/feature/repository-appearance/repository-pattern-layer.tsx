import { useWindowSize } from "@gpuix/react";
import { useMemo } from "react";
import { useAppTheme } from "../../styles/theme";
import {
	RepositoryPatternArtwork,
	repositoryPatternTileSize,
	repositoryPatternCornerOffset,
} from "./pattern-artwork";
import {
	defaultPatternAdjustments,
	type RepositoryPattern,
	type RepositoryPatternAdjustments,
} from "./repository-patterns";

/** Shared fixed-size masks behind chrome controls and opaque content. */
export function RepositoryPatternLayer({
	pattern,
	seed = 0,
	adjustments = defaultPatternAdjustments,
}: {
	pattern: RepositoryPattern;
	seed?: number;
	adjustments?: RepositoryPatternAdjustments;
}) {
	const theme = useAppTheme();
	const { width, height } = useWindowSize();
	const columns = Math.max(1, Math.ceil(width / repositoryPatternTileSize));

	const artwork = useMemo(
		() =>
			RepositoryPatternArtwork.create(pattern, seed, {
				layout: adjustments.layout,
				density: adjustments.density,
				size: adjustments.size,
				variation: adjustments.variation,
				strength: 50,
			}),
		[
			pattern,
			seed,
			adjustments.layout,
			adjustments.density,
			adjustments.size,
			adjustments.variation,
		]
	);

	const rows = Math.max(1, Math.ceil(height / artwork.tileHeight));

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
							Math.floor(index / columns) * artwork.tileHeight +
							(index === 0 ? 0 : repositoryPatternCornerOffset),
						left: (index % columns) * repositoryPatternTileSize,
						width: repositoryPatternTileSize,
						height:
							artwork.tileHeight +
							(index === 0 ? repositoryPatternCornerOffset : 0),
						color: theme.colors.brand,
						opacity:
							((theme.appearance === "dark" ? 0.24 : 0.18) *
								adjustments.strength) /
							50,
						pointerEvents: "none",
					}}
				/>
			))}
		</div>
	);
}

import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, radius } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { StateMessage } from "../../../fixture/state-message";

import { useSvgPreview } from "../hooks/use-svg-preview";
import type {
	RepositoryImageComparison,
	RepositoryImageSide,
} from "../lib/repository-image";

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		comparison: {
			display: "flex",
			flexDirection: "row",
			flexGrow: 1,
			minHeight: 0,
			minWidth: 0,
			padding: spacing[3.5],
			gap: spacing[3.5],
		},
		version: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			flexBasis: 0,
			minWidth: 0,
			minHeight: 0,
			gap: spacing[2.5],
		},
		caption: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			flexShrink: 0,
			...typography.xs,
			color: appColors.editorMuted,
		},
		metadata: {
			...typography.xs,
			color: appColors.editorFaint,
			marginLeft: spacing[1.5],
			minWidth: 0,
			maxWidth: "50%",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			overflow: "hidden",
		},
		viewport: {
			position: "relative",
			flexGrow: 1,
			minHeight: 0,
			minWidth: 0,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			overflow: "hidden",
			borderRadius: radius.md,
			backgroundColor: appColors.editorSunken,
		},
		image: {
			position: "absolute",
			left: 0,
			top: 0,
			width: "100%",
			height: "100%",
		},
	});

	const statusColors = {
		Added: appColors.success,
		Deleted: appColors.deletion,
	};

	return { styles, statusColors };
});

const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;

	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;

	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

function ImageVersion({
	side,
	label,
	version,
	path,
}: {
	side: RepositoryImageSide;
	label: "Before" | "After" | "Added" | "Deleted";
	version: "before" | "after";
	path: string;
}) {
	const theme = useAppTheme();
	const { styles, statusColors } = themedStyles.get(theme);

	const { image, error } = side;
	const preview = useSvgPreview(image);

	return (
		<div
			testId={`image-${version}`}
			role="group"
			aria-label={`${label} version of ${path}`}
			style={styles.version}
		>
			<div style={styles.caption}>
				<text
					testId={`image-${version}-label`}
					style={
						label === "Added" || label === "Deleted"
							? { color: statusColors[label] }
							: undefined
					}
				>
					{label}
				</text>
			</div>
			<div
				ref={preview.viewport}
				testId={`image-${version}-viewport`}
				style={styles.viewport}
			>
				{image && !preview.error ? (
					<img
						testId={`image-${version}-pixels`}
						src={preview.src}
						alt={`${label} version of ${path}`}
						objectFit="contain"
						style={styles.image}
					/>
				) : (
					<StateMessage
						artwork={error || preview.error ? "error" : "unavailable"}
						title={error ?? preview.error ?? "No image preview available"}
						compact
					/>
				)}
			</div>
		</div>
	);
}

/** Original image dimensions and sizes for the file header, labeled when comparing versions. */
export function RepositoryImageMetadata({
	comparison,
}: {
	comparison: RepositoryImageComparison;
}) {
	const theme = useAppTheme();
	const { styles } = themedStyles.get(theme);

	const parts: string[] = [];
	const comparing = comparison.before !== null && comparison.after !== null;

	for (const [label, side] of [
		["Before", comparison.before],
		["After", comparison.after],
	] as const) {
		if (!side?.image) continue;

		const { width, height, sizeBytes } = side.image;

		parts.push(
			`${comparing ? `${label}: ` : ""}${width} × ${height} · ${formatBytes(sizeBytes)}`
		);
	}

	if (parts.length === 0) return null;

	const description = parts.join(" → ");

	return (
		<text
			testId="image-metadata"
			aria-label={description}
			style={styles.metadata}
		>
			{description}
		</text>
	);
}

/** Native, aspect-preserving image comparisons with status captions and per-version failures. */
export function RepositoryImagePreview({
	comparison,
	path,
}: {
	comparison: RepositoryImageComparison;
	path: string;
}) {
	const theme = useAppTheme();
	const { styles } = themedStyles.get(theme);

	return (
		<div testId="image-preview" style={styles.comparison}>
			{comparison.before ? (
				<ImageVersion
					side={comparison.before}
					version="before"
					label={comparison.after ? "Before" : "Deleted"}
					path={path}
				/>
			) : null}
			{comparison.after ? (
				<ImageVersion
					side={comparison.after}
					version="after"
					label={comparison.before ? "After" : "Added"}
					path={path}
				/>
			) : null}
			{!comparison.before && !comparison.after ? (
				<StateMessage
					artwork="unavailable"
					title="No image content is available. Refresh Changes to try again."
				/>
			) : null}
		</div>
	);
}

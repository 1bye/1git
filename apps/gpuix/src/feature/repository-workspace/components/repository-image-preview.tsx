import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import type {
	RepositoryImageComparison,
	RepositoryImageSide,
} from "../lib/repository-image";

const styles = StyleSheet.create({
	comparison: {
		display: "flex",
		flexDirection: "row",
		flexGrow: 1,
		minHeight: 0,
		minWidth: 0,
		padding: 14,
		gap: 14,
	},
	version: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		flexBasis: 0,
		minWidth: 0,
		minHeight: 0,
		gap: 10,
	},
	caption: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		fontSize: 10,
		color: lightColors.editorMuted,
	},
	metadata: {
		fontSize: 10,
		color: lightColors.editorFaint,
		marginLeft: 6,
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
		borderRadius: 6,
		backgroundColor: lightColors.editorSunken,
	},
	image: {
		position: "absolute",
		left: 0,
		top: 0,
		width: "100%",
		height: "100%",
	},
	error: { fontSize: 11, color: lightColors.editorMuted, padding: 16 },
});

const statusColors = { Added: "#1a7f37", Deleted: "#b2676b" };

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
	const { image, error } = side;

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
			<div testId={`image-${version}-viewport`} style={styles.viewport}>
				{image ? (
					<img
						testId={`image-${version}-pixels`}
						src={image.src}
						alt={`${label} version of ${path}`}
						objectFit="contain"
						style={styles.image}
					/>
				) : (
					<text role="status" style={styles.error}>
						{error}
					</text>
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
				<text role="status" style={styles.error}>
					No image content is available. Refresh Changes to try again.
				</text>
			) : null}
		</div>
	);
}

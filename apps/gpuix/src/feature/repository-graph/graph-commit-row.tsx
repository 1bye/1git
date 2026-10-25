import { radius, spacing, typography } from "@1git/design-tokens";
import { useWindowSize } from "@gpuix/react";
import {
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../styles/theme";
import type { GraphRow } from "./commit-graph";
import type { GraphReference } from "./repository-graph-reader";
import { RepositoryCommitSubject } from "../repository-workspace/components/repository-commit-subject";

export const graphRowHeight = 36;
const laneSpacing = 18;
const graphInset = 10;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Width shared by the native row and its horizontal viewport. */
export const graphLaneWidth = (lanes: number): number =>
	graphInset * 2 + Math.max(1, lanes) * laneSpacing;

/** Metadata columns scale with the user's text size and collapse in compact windows. */
export const graphColumnWidths = (width: number, fontSize = 12) => ({
	hash: Math.ceil((58 * fontSize) / 12),
	author: width >= 1000 ? Math.ceil((110 * fontSize) / 12) : 0,
	date: width >= 850 ? Math.ceil((95 * fontSize) / 12) : 0,
});

/** Theme-aware lane colors remain stable as more commit pages are appended. */
export const graphColors = {
	light: ["#7760b5", "#16876a", "#b27620", "#bf5677", "#377eb5", "#8b7938"],
	dark: ["#b3a0ff", "#63d6b2", "#e9b45f", "#ed8aaa", "#80b7ec", "#c6cb79"],
} as const;

/** Native SVG masks for each colored connection share the commit row's scroll/focus lifecycle. */
export function GraphCommitRow({
	row,
	lanes,
	references,
	head,
	selected = false,
}: {
	row: GraphRow;
	lanes: number;
	references: readonly GraphReference[];
	head: string | null;
	selected?: boolean;
}) {
	const { appearance, colors, tokens, typography: fonts } = useAppTheme();
	const window = useWindowSize();
	const columns = graphColumnWidths(window.width, fonts?.fontSize);
	const palette = graphColors[appearance];
	const width = graphLaneWidth(lanes);
	const x = (lane: number): number => graphInset + lane * laneSpacing;
	const paths = new Map<number, string[]>();

	for (const edge of row.edges) {
		const color = edge.color % palette.length;
		const segments = paths.get(color) ?? [];
		const y1 = edge.half === "top" ? 0 : graphRowHeight / 2;
		const y2 = edge.half === "top" ? graphRowHeight / 2 : graphRowHeight;
		const middle = (y1 + y2) / 2;

		segments.push(
			`M${x(edge.from)} ${y1} C${x(edge.from)} ${middle} ${x(edge.to)} ${middle} ${x(edge.to)} ${y2}`
		);
		paths.set(color, segments);
	}

	const date = new Date(row.commit.committedAt);

	const dateLabel = Number.isNaN(date.valueOf())
		? row.commit.committedAt
		: dateFormat.format(date);

	const primary =
		references.find((ref) => ref.current) ??
		references.find((ref) => ref.kind === "local") ??
		references.find((ref) => ref.kind === "tag") ??
		references[0];

	const remaining = references.length - (primary ? 1 : 0);

	const referenceDescription = [
		...(row.commit.oid === head ? ["HEAD · Current commit"] : []),
		...references.map(
			(ref) =>
				`${ref.kind === "tag" ? "Tag" : ref.kind === "remote" ? "Remote branch" : "Local branch"}: ${ref.name}`
		),
	].join("\n");

	const badges = [
		...(row.commit.oid === head
			? [{ id: "HEAD", name: "HEAD", kind: "local" as const }]
			: []),
		...(primary ? [primary] : []),
	];

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				flexGrow: 1,
				minWidth: 0,
				height: graphRowHeight,
				gap: spacing[2],
			}}
		>
			<div
				testId={`graph-lanes-${row.commit.oid}`}
				aria-hidden
				style={{
					position: "relative",
					width,
					height: graphRowHeight,
					flexShrink: 0,
					pointerEvents: "none",
				}}
			>
				{[...paths].map(([color, segments]) => (
					<svg
						key={color}
						source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${graphRowHeight}" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${segments.join(" ")}"/></svg>`}
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							width,
							height: graphRowHeight,
							color: palette[color],
						}}
					/>
				))}
				<div
					style={{
						position: "absolute",
						left: x(row.lane) - 4,
						top: graphRowHeight / 2 - 4,
						width: 8,
						height: 8,
						borderRadius: 4,
						borderWidth: row.commit.parentOids.length > 1 ? 3 : 2,
						borderColor: palette[row.color % palette.length],
						backgroundColor: colors.editorSurface,
					}}
				/>
			</div>
			{badges.length ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<div
							testId={`graph-labels-${row.commit.oid}`}
							role="group"
							aria-label={referenceDescription}
							tabIndex={selected ? 0 : -1}
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: spacing[1],
								maxWidth: window.width < 850 ? 160 : 400,
								minWidth: row.commit.oid === head ? 100 : 60,
								flexShrink: 1,
							}}
						>
							{badges.map((ref) => (
								<text
									key={ref.id}
									testId={`graph-badge-${row.commit.oid}-${ref.id}`}
									style={{
										...typography.xs,
										flexShrink: ref.id === "HEAD" ? 0 : 1,
										minWidth: 0,
										paddingLeft: spacing[1.5],
										paddingRight: spacing[1.5],
										borderRadius: radius.sm,
										backgroundColor: colors.editorSunken2,
										color:
											ref.kind === "remote"
												? colors.success
												: ref.kind === "tag"
													? palette[2]
													: palette[0],
										whiteSpace: "nowrap",
										overflowX: "hidden",
										textOverflow: "ellipsis",
										pointerEvents: "none",
									}}
								>{`${ref.kind === "tag" ? "◇ " : ""}${ref.name}`}</text>
							))}
							{remaining ? (
								<text
									testId={`graph-more-labels-${row.commit.oid}`}
									style={{
										...typography.xs,
										color: colors.editorMuted,
										paddingLeft: spacing[1],
										paddingRight: spacing[1],
										borderRadius: radius.sm,
										backgroundColor: colors.editorSunken2,
										flexShrink: 0,
										whiteSpace: "nowrap",
										pointerEvents: "none",
									}}
								>{`+${remaining}`}</text>
							) : null}
						</div>
					</TooltipTrigger>
					<TooltipContent
						testId={`graph-labels-tooltip-${row.commit.oid}`}
						tokens={tokens}
						side="bottom"
						align="start"
						style={{ maxWidth: Math.min(560, window.width - 32) }}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[1],
							}}
						>
							{referenceDescription.split("\n").map((name) => (
								<text
									key={name}
									style={{ ...typography.sm, whiteSpace: "normal" }}
								>
									{name}
								</text>
							))}
						</div>
					</TooltipContent>
				</Tooltip>
			) : null}
			<RepositoryCommitSubject
				subject={row.commit.summary || "Untitled commit"}
				testId={`graph-subject-${row.commit.oid}`}
			/>
			{columns.author ? (
				<text
					style={{
						...typography.xs,
						color: colors.editorMuted,
						width: columns.author,
						flexShrink: 0,
						whiteSpace: "nowrap",
						overflowX: "hidden",
						textOverflow: "ellipsis",
						pointerEvents: "none",
					}}
				>
					{row.commit.author.name}
				</text>
			) : null}
			<text
				testId={`graph-hash-${row.commit.oid}`}
				style={{
					...typography.xs,
					color: colors.editorFaint,
					width: columns.hash,
					flexShrink: 0,
					fontFamily: fonts?.codeFontFamily || "monospace",
					whiteSpace: "nowrap",
					overflowX: "hidden",
					textOverflow: "ellipsis",
					pointerEvents: "none",
				}}
			>
				{row.commit.oid.slice(0, 7)}
			</text>
			{columns.date ? (
				<text
					style={{
						...typography.xs,
						color: colors.editorFaint,
						width: columns.date,
						flexShrink: 0,
						whiteSpace: "nowrap",
						overflowX: "hidden",
						textOverflow: "ellipsis",
						pointerEvents: "none",
					}}
				>
					{dateLabel}
				</text>
			) : null}
		</div>
	);
}

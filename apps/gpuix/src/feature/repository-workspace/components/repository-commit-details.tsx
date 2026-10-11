import { radius, spacing, typography } from "@1git/design-tokens";
import type { CommitInfo, TagInfo } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import { useLayoutEffect, useRef, useState } from "react";

import { NativeClipboard } from "../../../platform/clipboard";
import { useAppTheme } from "../../../styles/theme";
import { RepositoryHistory } from "../lib/repository-history";
import { RepositoryCommitSubject } from "./repository-commit-subject";

const collapsedDescriptionHeight = typography.sm.lineHeight * 3;
const expandedDescriptionHeight = 160;
const paragraphSeparator = /\n[\t ]*\n/u;

const commitDate = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

/** Selected-commit metadata stays outside the file preview, including commits with no changed files. Key by workspace/commit to reset disclosure. */
export function RepositoryCommitDetails({
	commit,
	tags,
}: {
	commit: CommitInfo;
	tags: readonly TagInfo[];
}) {
	const { colors, tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const descriptionNode = useRef<PublicInstance>(null);
	const [expanded, setExpanded] = useState(false);
	const [previewOverflows, setPreviewOverflows] = useState(false);

	const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
		"idle"
	);

	const description = RepositoryHistory.description(commit);
	const previewDescription = description.split(paragraphSeparator, 1)[0] ?? "";

	const hasMoreDescription =
		previewDescription !== description || previewOverflows;

	const date = new Date(commit.authoredAt);

	const authored = Number.isNaN(date.valueOf())
		? commit.authoredAt
		: commitDate.format(date);

	const commitTags = tags.filter((tag) => tag.targetOid === commit.oid);

	useLayoutEffect(() => {
		if (expanded) return;

		const node = descriptionNode.current;
		const bounds = node ? renderer.getElementBounds?.(node.id) : null;

		setPreviewOverflows((bounds?.height ?? 0) > collapsedDescriptionHeight);
	}, [expanded, previewDescription, renderer, window.width]);

	const copy = async (): Promise<void> => {
		try {
			await NativeClipboard.write(commit.oid);
			setCopyState("copied");
		} catch {
			setCopyState("error");
		}
	};

	return (
		<div
			testId="commit-details"
			role="group"
			aria-label="Selected commit"
			style={{
				display: "flex",
				flexDirection: "column",
				flexShrink: 0,
				minWidth: 0,
				gap: spacing[1],
				padding: spacing[2.5],
				paddingLeft: spacing[3.5],
				paddingRight: spacing[3],
				borderBottomWidth: 1,
				borderColor: colors.editorHairline,
			}}
		>
			<div
				role="heading"
				aria-level={2}
				aria-label={commit.summary || "Untitled commit"}
				style={{ maxHeight: 64, overflowY: "scroll", overflowX: "hidden" }}
			>
				<RepositoryCommitSubject
					subject={commit.summary || "Untitled commit"}
					testId="commit-details-title"
					wrap
				/>
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					gap: spacing[1.5],
				}}
			>
				<text
					testId="commit-details-author"
					role="text"
					aria-label={`${commit.author.name} <${commit.author.email}>`}
					style={{ ...typography.xs, color: colors.editorMuted }}
				>
					{commit.author.name}
				</text>
				<text
					testId="commit-details-date"
					role="text"
					aria-label={`Authored ${authored}`}
					style={{ ...typography.xs, color: colors.editorFaint }}
				>{`· ${authored}`}</text>
				<Button
					testId="commit-details-copy-sha"
					aria-label="Copy commit SHA"
					aria-description={commit.oid}
					tokens={tokens}
					size="sm"
					variant="ghost"
					style={{
						height: 20,
						paddingLeft: spacing[1],
						paddingRight: spacing[1],
					}}
					textStyle={{ ...typography.xs, color: colors.editorMuted }}
					onPress={() => void copy()}
				>{`${commit.oid.slice(0, 7)}${copyState === "copied" ? " · Copied" : ""}`}</Button>
				{commitTags.length ? (
					<text
						testId="commit-details-tags"
						role="text"
						aria-label={`Tags: ${commitTags.map((tag) => tag.name).join(", ")}`}
						style={{
							...typography.xs,
							color: colors.editorMuted,
							backgroundColor: colors.editorSunken,
							borderRadius: radius.sm,
							paddingLeft: spacing[1],
							paddingRight: spacing[1],
							maxWidth: 180,
							whiteSpace: "nowrap",
							textOverflow: "ellipsis",
							overflowX: "hidden",
						}}
					>
						{commitTags.map((tag) => tag.name).join(", ")}
					</text>
				) : null}
				{hasMoreDescription ? (
					<Button
						testId="commit-details-toggle-description"
						aria-label={
							expanded ? "Show less description" : "Show more description"
						}
						aria-expanded={expanded}
						tokens={tokens}
						variant="ghost"
						size="sm"
						style={{
							height: 20,
							paddingLeft: spacing[1],
							paddingRight: spacing[1],
						}}
						textStyle={{ ...typography.xs, color: colors.editorMuted }}
						onPress={() => setExpanded((value) => !value)}
					>
						{expanded ? "Show less" : "Show more"}
					</Button>
				) : null}
			</div>
			{description ? (
				<div
					testId="commit-details-description-viewport"
					style={{
						maxHeight: expanded
							? Math.max(
									collapsedDescriptionHeight,
									Math.min(expandedDescriptionHeight, window.height / 4)
								)
							: collapsedDescriptionHeight,
						overflowY: expanded ? "scroll" : "hidden",
						overflowX: "hidden",
					}}
				>
					<text
						ref={descriptionNode}
						testId="commit-details-description"
						role="text"
						aria-label={description}
						style={{
							...typography.sm,
							color: colors.editorMuted,
							flexShrink: 0,
							width: "100%",
							userSelect: "text",
						}}
					>
						{expanded ? description : previewDescription}
					</text>
				</div>
			) : null}
			{copyState === "error" ? (
				<text role="alert" style={{ ...typography.xs, color: colors.deletion }}>
					Could not copy SHA. Try again.
				</text>
			) : null}
		</div>
	);
}

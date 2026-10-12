import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { CommitSubject } from "../lib/commit-subject";
import { commitTypeColor } from "./commit-type-colors";

const themedStyles = createThemedStyles(({ colors }) => ({
	label: {
		...typography.sm,
		fontWeight: fontWeight.regular,
		color: colors.editorInk,
		flexGrow: 1,
		minWidth: 0,
		overflowX: "hidden" as const,
		whiteSpace: "nowrap" as const,
		textOverflow: "ellipsis" as const,
		pointerEvents: "none" as const,
	},
}));

/** Compact, theme-aware commit labels; accessible names and actions retain the complete original subject. */
export function RepositoryCommitSubject({
	subject,
	testId,
	wrap = false,
}: {
	subject: string;
	testId: string;
	wrap?: boolean;
}) {
	const { appearance, commitTypeBadges } = useAppTheme();
	const { label } = themedStyles[appearance];
	const parsed = commitTypeBadges ? CommitSubject.parse(subject) : null;

	const textStyle = wrap
		? { ...label, whiteSpace: "normal" as const, textOverflow: undefined }
		: label;

	if (!parsed)
		return (
			<text testId={testId} style={textStyle}>
				{subject}
			</text>
		);

	return (
		<div
			testId={testId}
			aria-label={subject}
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: wrap ? "flex-start" : "center",
				gap: spacing[1.5],
				flexGrow: 1,
				minWidth: 0,
				pointerEvents: "none",
			}}
		>
			<text
				testId={`${testId}-badge`}
				aria-hidden
				style={{
					...typography.xs,
					...commitTypeColor(appearance, parsed.type),
					fontWeight: fontWeight.medium,
					borderRadius: radius.sm,
					paddingLeft: spacing[1],
					paddingRight: spacing[1],
					paddingTop: spacing[0.25],
					paddingBottom: spacing[0.25],
					flexShrink: 0,
					pointerEvents: "none",
				}}
			>{`${parsed.type}${parsed.breaking ? "!" : ""}`}</text>
			<text testId={`${testId}-text`} style={textStyle}>
				{`${parsed.scope ? `(${parsed.scope}) ` : ""}${parsed.description}`}
			</text>
		</div>
	);
}

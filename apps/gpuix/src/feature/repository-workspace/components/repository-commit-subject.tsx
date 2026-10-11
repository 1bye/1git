import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { CommitSubject, type CommitType } from "../lib/commit-subject";

const tones = {
	light: {
		green: { color: "#38664a", backgroundColor: "#edf4ef" },
		red: { color: "#955053", backgroundColor: "#f8eeee" },
		purple: { color: "#705a8b", backgroundColor: "#f3eff7" },
		amber: { color: "#80633d", backgroundColor: "#f6f1e8" },
		blue: { color: "#496b92", backgroundColor: "#edf2f8" },
		neutral: { color: "#606775", backgroundColor: "#f0f1f3" },
	},
	dark: {
		green: { color: "#9cc5ab", backgroundColor: "#2b3b32" },
		red: { color: "#d8a3a7", backgroundColor: "#443034" },
		purple: { color: "#beadd8", backgroundColor: "#37303f" },
		amber: { color: "#d2ba95", backgroundColor: "#3e372c" },
		blue: { color: "#a5bfdb", backgroundColor: "#2b3542" },
		neutral: { color: "#b3b8c2", backgroundColor: "#30333a" },
	},
} as const;

const typeTone: Record<CommitType, keyof typeof tones.light> = {
	feat: "green",
	fix: "red",
	refactor: "purple",
	perf: "amber",
	docs: "blue",
	test: "blue",
	build: "neutral",
	ci: "neutral",
	chore: "neutral",
	style: "neutral",
	revert: "red",
};

const themedStyles = createThemedStyles(({ colors, appearance }) => ({
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
	badges: tones[appearance],
}));

/** Compact, theme-aware commit labels; accessible names and actions retain the complete original subject. */
export function RepositoryCommitSubject({
	subject,
	testId,
}: {
	subject: string;
	testId: string;
}) {
	const { appearance, commitTypeBadges } = useAppTheme();
	const { label, badges } = themedStyles[appearance];
	const parsed = commitTypeBadges ? CommitSubject.parse(subject) : null;

	if (!parsed)
		return (
			<text testId={testId} style={label}>
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
				alignItems: "center",
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
					...badges[typeTone[parsed.type]],
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
			<text testId={`${testId}-text`} style={label}>
				{`${parsed.scope ? `(${parsed.scope}) ` : ""}${parsed.description}`}
			</text>
		</div>
	);
}

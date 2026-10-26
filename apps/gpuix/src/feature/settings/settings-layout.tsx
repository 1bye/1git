import { fontWeight, spacing, typography } from "@1git/design-tokens";
import type { PublicInstance } from "@gpuix/react";
import type { ReactElement, ReactNode, Ref } from "react";
import { createThemedStyles, useAppTheme } from "../../styles/theme";

/** Shared sizing for Settings pages and their nested forms. */
export const settingsLayout = {
	padding: spacing[4],
	titleGap: spacing[1],
	headerGap: spacing[5],
	sectionGap: spacing[6],
	rowGap: spacing[3],
	labelGap: spacing[1],
	width: 480,
	wideWidth: 760,
} as const;

/** Text roles and layout rules shared by Settings pages, forms and guides. */
export const settingsStyles = createThemedStyles(
	({ tokens: { colors } }) =>
		({
			title: {
				...typography.lg,
				fontWeight: fontWeight.medium,
				color: colors.text,
			},
			sectionTitle: {
				...typography.md,
				fontWeight: fontWeight.medium,
				color: colors.text,
			},
			label: { ...typography.md, color: colors.text },
			description: { ...typography.sm, color: colors.textMuted },
			error: { ...typography.sm, color: colors.danger },
			navGroup: {
				...typography.xs,
				fontWeight: fontWeight.medium,
				color: colors.textMuted,
			},
			column: {
				display: "flex",
				flexDirection: "column",
				minWidth: 0,
				flexShrink: 0,
				gap: settingsLayout.rowGap,
			},
			header: {
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: settingsLayout.rowGap,
				flexShrink: 0,
			},
			pane: {
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				flexShrink: 1,
				flexBasis: 0,
				minWidth: 0,
				minHeight: 0,
			},
			footer: {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0,
				gap: spacing[2],
				padding: settingsLayout.padding,
				borderTopWidth: 1,
				borderColor: colors.border,
			},
		}) as const
);

/** A scrollable Settings page with one shared header, width and spacing scale. */
export function SettingsPage({
	title,
	description,
	action,
	width = "default",
	testId,
	scrollTestId,
	headerTestId,
	titleTestId,
	descriptionTestId,
	children,
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	width?: "default" | "wide";
	testId: string;
	scrollTestId?: string;
	headerTestId?: string;
	titleTestId?: string;
	descriptionTestId?: string;
	children: ReactNode;
}) {
	const styles = settingsStyles.get(useAppTheme());

	const maxWidth =
		(width === "wide" ? settingsLayout.wideWidth : settingsLayout.width) +
		settingsLayout.padding * 2;

	const header = (
		<div
			style={{
				...styles.column,
				gap: settingsLayout.titleGap,
				marginBottom: scrollTestId ? 0 : settingsLayout.headerGap,
			}}
			testId={headerTestId}
		>
			<div style={styles.header}>
				<text
					testId={titleTestId}
					role="heading"
					aria-level={1}
					style={styles.title}
				>
					{title}
				</text>
				{action}
			</div>
			{description ? (
				<text testId={descriptionTestId} style={styles.description}>
					{description}
				</text>
			) : null}
		</div>
	);

	// Native scrollIntoView reveals a direct scroll child; keep sections outside a page-sized wrapper.
	const body = (
		<div
			testId={scrollTestId ?? testId}
			style={{
				...styles.pane,
				overflowY: "scroll",
				padding: settingsLayout.padding,
				paddingTop: scrollTestId ? 0 : settingsLayout.padding,
				width: "100%",
				maxWidth,
			}}
		>
			{scrollTestId ? null : header}
			{children}
		</div>
	);

	return scrollTestId ? (
		<div testId={testId} style={styles.pane}>
			<div
				style={{
					...styles.column,
					padding: settingsLayout.padding,
					paddingBottom: settingsLayout.headerGap,
					width: "100%",
					maxWidth,
				}}
			>
				{header}
			</div>
			{body}
		</div>
	) : (
		body
	);
}

/** A related group of Settings controls, optionally introduced by a heading. */
export function SettingsSection({
	title,
	description,
	action,
	children,
	testId,
}: {
	title?: string;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	testId?: string;
}) {
	const styles = settingsStyles.get(useAppTheme());

	return (
		<div
			testId={testId}
			style={{ ...styles.column, marginBottom: settingsLayout.sectionGap }}
		>
			{title || action || description ? (
				<div style={{ ...styles.column, gap: settingsLayout.titleGap }}>
					{title || action ? (
						<div style={styles.header}>
							{title ? (
								<text role="heading" aria-level={2} style={styles.sectionTitle}>
									{title}
								</text>
							) : null}
							{action}
						</div>
					) : null}
					{description ? (
						<text style={styles.description}>{description}</text>
					) : null}
				</div>
			) : null}
			{children}
		</div>
	);
}

/** A field label and hint alongside its control, wrapping when space is limited. */
export function SettingsRow({
	label,
	description,
	control,
	testId,
}: {
	label: string;
	description?: ReactNode;
	control: ReactNode;
	testId?: string;
}) {
	const styles = settingsStyles.get(useAppTheme());

	return (
		<div testId={testId} style={{ ...styles.header, flexWrap: "wrap" }}>
			<div
				style={{
					...styles.column,
					flexGrow: 1,
					flexBasis: 160,
					gap: settingsLayout.labelGap,
				}}
			>
				<text style={styles.label}>{label}</text>
				{description ? (
					<text style={styles.description}>{description}</text>
				) : null}
			</div>
			{control}
		</div>
	);
}

type SettingsPanelProps = {
	ref?: Ref<PublicInstance>;
	title: string;
	description?: ReactNode;
	label: string;
	body: ReactNode;
	footer: ReactNode;
	testId?: string;
	headerTestId?: string;
	titleTestId?: string;
	scrollTestId?: string;
	bodyTestId?: string;
	footerTestId?: string;
};

/** Shared editor chrome; stateful editors keep ownership of their draft and focus. */
export function SettingsPanel({
	ref,
	title,
	description,
	label,
	body,
	footer,
	testId,
	headerTestId,
	titleTestId,
	scrollTestId,
	bodyTestId,
	footerTestId,
}: SettingsPanelProps) {
	const theme = useAppTheme();
	const styles = settingsStyles.get(theme);

	return (
		<div
			ref={ref}
			testId={testId}
			role="region"
			aria-label={label}
			style={{
				...styles.pane,
				borderLeftWidth: 1,
				borderColor: theme.tokens.colors.border,
			}}
		>
			<div
				testId={headerTestId}
				style={{
					...styles.column,
					padding: settingsLayout.padding,
					gap: settingsLayout.titleGap,
				}}
			>
				<text
					testId={titleTestId}
					role="heading"
					aria-level={2}
					style={styles.sectionTitle}
				>
					{title}
				</text>
				{description ? (
					<text style={styles.description}>{description}</text>
				) : null}
			</div>
			<div
				testId={scrollTestId}
				style={{
					...styles.pane,
					overflowY: "scroll",
					padding: settingsLayout.padding,
					paddingTop: 0,
				}}
			>
				<div
					testId={bodyTestId}
					style={{
						...styles.column,
						width: "100%",
						maxWidth: settingsLayout.width,
					}}
				>
					{body}
				</div>
			</div>
			<div testId={footerTestId} style={styles.footer}>
				{footer}
			</div>
		</div>
	);
}

/** Equal-width list and editor panes with independently scrolling content. */
export function SettingsSplit({
	list,
	children,
	panel,
	testId,
}: {
	list: ReactNode;
	children?: ReactNode;
	panel?: SettingsPanelProps | ReactElement | null;
	testId?: string;
}) {
	const styles = settingsStyles.get(useAppTheme());

	return (
		<div
			testId={testId}
			style={{
				...styles.pane,
				flexDirection: "row",
				height: "100%",
				flexBasis: undefined,
			}}
		>
			<div style={styles.pane}>{list}</div>
			{panel ? "body" in panel ? <SettingsPanel {...panel} /> : panel : null}
			{children}
		</div>
	);
}

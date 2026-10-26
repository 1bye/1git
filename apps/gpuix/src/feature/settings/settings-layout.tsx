import { fontWeight, spacing, typography } from "@1git/design-tokens";
import type { PublicInstance } from "@gpuix/react";
import { useRef, type ReactElement, type ReactNode, type Ref } from "react";
import { setRefs } from "@gpuix/react/floating";
import { Scrollbars } from "@1git/gpuix-ui/scrollbar";
import { createThemedStyles, useAppTheme } from "../../styles/theme";

// Main add/create actions belong in secondary page-header buttons; group actions stay in their card.
// Primary buttons submit panel forms. Edit items in side panels; popovers only confirm destructive actions.

/** Shared sizing for Settings pages and their nested forms. */
export const settingsLayout = {
	padding: spacing[4],
	titleGap: spacing[1],
	headerGap: spacing[5],
	sectionGap: spacing[6],
	rowGap: spacing[3],
	labelGap: spacing[1],
	width: 480,
	singleWidth: 560,
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
	scrollRef,
	headerTestId,
	titleTestId,
	descriptionTestId,
	children,
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	width?: "default" | "single" | "wide";
	testId: string;
	scrollTestId?: string;
	scrollRef?: Ref<PublicInstance>;
	headerTestId?: string;
	titleTestId?: string;
	descriptionTestId?: string;
	children: ReactNode;
}) {
	const theme = useAppTheme();
	const styles = settingsStyles.get(theme);
	const scroll = useRef<PublicInstance>(null);

	const maxWidth =
		{
			default: settingsLayout.width,
			single: settingsLayout.singleWidth,
			wide: settingsLayout.wideWidth,
		}[width] +
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
		<>
			<div
				ref={(node) => setRefs(node, scroll, scrollRef)}
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
			<Scrollbars
				vertical={scroll}
				tokens={theme.tokens}
				testId={`${scrollTestId ?? testId}-scrollbar`}
			/>
		</>
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
	footer?: ReactNode;
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
	const scroll = useRef<PublicInstance>(null);

	return (
		<div
			ref={ref}
			testId={testId}
			role="region"
			aria-label={label}
			style={{
				...styles.pane,
				height: "100%",
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
				ref={scroll}
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
			<Scrollbars
				vertical={scroll}
				tokens={theme.tokens}
				testId={`${scrollTestId ?? testId ?? "settings-panel"}-scrollbar`}
			/>
			{footer ? (
				<div testId={footerTestId} style={styles.footer}>
					<div
						style={{
							...styles.column,
							width: "100%",
							maxWidth: settingsLayout.width,
						}}
					>
						{footer}
					</div>
				</div>
			) : null}
		</div>
	);
}

/** A settings-only preview; it shares editor chrome without form actions. */
export function SettingsPreview({
	children,
	description,
	testId = "settings-preview",
}: {
	children: ReactNode;
	description?: ReactNode;
	testId?: string;
}) {
	return (
		<SettingsPanel
			testId={testId}
			title="Preview"
			label="Preview"
			description={description}
			body={children}
		/>
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

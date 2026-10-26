import { radius, spacing } from "@1git/design-tokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { settingsLayout, settingsStyles } from "./settings-layout";

const groupStyles = createThemedStyles(
	({ tokens }) =>
		({
			card: {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0,
				minWidth: 0,
				borderWidth: 1,
				borderColor: tokens.colors.border,
				borderRadius: radius.lg,
				backgroundColor: tokens.colors.background,
			},
			header: {
				flexWrap: "wrap",
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: spacing[2],
				padding: spacing[3],
				paddingLeft: spacing[4],
				paddingRight: spacing[4],
				backgroundColor: tokens.colors.surface,
				borderTopLeftRadius: radius.lg,
				borderTopRightRadius: radius.lg,
				flexShrink: 0,
			},
			row: {
				flexWrap: "wrap",
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: settingsLayout.rowGap,
				paddingTop: spacing[1.5],
				paddingBottom: spacing[1.5],
				paddingLeft: spacing[4],
				paddingRight: spacing[4],
				borderTopWidth: 1,
				borderColor: tokens.colors.surface,
				flexShrink: 0,
				minWidth: 0,
			},
		}) as const
);

/** A Settings list card with a tinted heading, related actions and an optional hint. */
export function SettingsGroup({
	title,
	meta,
	action,
	label = title,
	footer,
	testId,
	children,
}: {
	title: string;
	meta?: ReactNode;
	action?: ReactNode;
	label?: string;
	footer?: ReactNode;
	testId?: string;
	children: ReactNode;
}) {
	const theme = useAppTheme();
	const styles = settingsStyles.get(theme);
	const groups = groupStyles.get(theme);

	// Footerless cards need no extra native flex parent around every list row.
	const card = (
		<div
			testId={testId}
			role="group"
			aria-label={label}
			style={{
				...groups.card,
				marginBottom: footer ? 0 : settingsLayout.sectionGap,
			}}
		>
			<div style={groups.header}>
				<text
					role="heading"
					aria-level={2}
					style={{
						...styles.sectionTitle,
						flexGrow: 1,
						flexBasis: 80,
						minWidth: 0,
						flexShrink: 1,
					}}
				>
					{title}
				</text>
				{meta ? <text style={styles.description}>{meta}</text> : null}
				{action}
			</div>
			{children}
		</div>
	);

	return footer ? (
		<div
			style={{
				...styles.column,
				gap: spacing[2],
				marginBottom: settingsLayout.sectionGap,
			}}
		>
			{card}
			<text style={styles.description}>{footer}</text>
		</div>
	) : (
		card
	);
}

/** A divided list row; its main target and trailing controls activate independently. */
export function SettingsGroupRow({
	"aria-description": accessibleDescription,
	"aria-label": accessibleLabel,
	role,
	contentTestId,
	leading,
	label,
	description,
	badge,
	trailing,
	selected,
	onPress,
	disabled = false,
	testId,
}: {
	"aria-description"?: string;
	"aria-label"?: string;
	role?: "group";
	contentTestId?: string;
	leading?: ReactNode;
	label: ReactNode;
	description?: ReactNode;
	badge?: ReactNode;
	trailing?: ReactNode;
	selected?: boolean;
	onPress?: () => void;
	disabled?: boolean;
	testId?: string;
}) {
	const theme = useAppTheme();
	const styles = settingsStyles.get(theme);
	const groups = groupStyles.get(theme);
	const [focused, setFocused] = useState(false);
	const armed = useRef(false);
	const interactive = !!onPress && !disabled;

	useEffect(() => {
		if (!interactive) armed.current = false;
	}, [interactive]);

	const content = (
		<>
			{leading}
			<div
				testId={contentTestId}
				style={{
					...styles.column,
					flexGrow: 1,
					flexShrink: 1,
					flexBasis: 90,
					minWidth: 90,
					gap: 0,
				}}
			>
				{typeof label === "string" || typeof label === "number" ? (
					<text style={styles.label}>{label}</text>
				) : (
					label
				)}
				{description ? (
					typeof description === "string" || typeof description === "number" ? (
						<text style={styles.description}>{description}</text>
					) : (
						description
					)
				) : null}
			</div>
			{badge ? (
				typeof badge === "string" || typeof badge === "number" ? (
					<text style={styles.description}>{badge}</text>
				) : (
					badge
				)
			) : null}
		</>
	);

	return (
		<div
			testId={onPress ? undefined : testId}
			role={role}
			aria-label={role ? accessibleLabel : undefined}
			style={{
				...groups.row,
				backgroundColor: selected ? theme.tokens.colors.selected : undefined,
			}}
		>
			{/* Static rows stay flat to avoid repeated native flex measurement in long lists. */}
			{onPress ? (
				<div
					testId={testId}
					role="button"
					aria-label={
						accessibleLabel ?? (typeof label === "string" ? label : undefined)
					}
					aria-description={
						accessibleDescription ?? (selected ? "Selected" : undefined)
					}
					aria-disabled={disabled || undefined}
					tabIndex={interactive ? 0 : undefined}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: settingsLayout.rowGap,
						flexGrow: 1,
						flexBasis: 128,
						flexWrap: "wrap",
						flexShrink: 1,
						minWidth: 100,
						cursor: interactive ? "pointer" : undefined,
						borderWidth: 1,
						borderColor: focused
							? theme.tokens.colors.focusRing
							: "transparent",
						borderRadius: radius.md,
						opacity: disabled ? 0.45 : 1,
					}}
					onFocus={() => setFocused(true)}
					onBlur={() => {
						setFocused(false);
						armed.current = false;
					}}
					onClick={interactive ? onPress : undefined}
					onKeyDown={
						interactive
							? (event) => {
									if (
										!interactive ||
										event.isHeld ||
										event.modifiers?.cmd ||
										event.modifiers?.ctrl ||
										event.modifiers?.alt
									)
										return;

									if (event.key === "enter") onPress?.();
									else if (event.key === "space") armed.current = true;
								}
							: undefined
					}
					onKeyUp={
						interactive
							? (event) => {
									if (event.key !== "space") return;

									const activate = armed.current;

									armed.current = false;

									if (interactive && activate) onPress?.();
								}
							: undefined
					}
				>
					{content}
				</div>
			) : (
				content
			)}
			{trailing}
		</div>
	);
}

/** A quiet empty state inside a grouped list. */
export function SettingsGroupEmpty({
	children,
	testId,
}: {
	children: ReactNode;
	testId?: string;
}) {
	const theme = useAppTheme();

	return (
		<div testId={testId} style={groupStyles.get(theme).row}>
			<text
				style={{
					...settingsStyles.get(theme).description,
					flexShrink: 1,
					minWidth: 0,
				}}
			>
				{children}
			</text>
		</div>
	);
}

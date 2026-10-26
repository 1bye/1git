import { radius, spacing } from "@1git/design-tokens";
import {
	useRef,
	useState,
	type ComponentProps,
	type ReactElement,
	type ReactNode,
} from "react";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
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
	icon,
	meta,
	action,
	label = title,
	footer,
	testId,
	children,
}: {
	title: string;
	icon?: ComponentProps<typeof WorkspaceTabIcon>["name"] | ReactElement;
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

	return (
		<div
			style={{
				...styles.column,
				gap: spacing[2],
				marginBottom: settingsLayout.sectionGap,
			}}
		>
			<div testId={testId} role="group" aria-label={label} style={groups.card}>
				<div style={groups.header}>
					{typeof icon === "string" ? (
						<WorkspaceTabIcon name={icon} size={16} />
					) : (
						icon
					)}
					<text
						role="heading"
						aria-level={2}
						style={{ ...styles.sectionTitle, flexGrow: 1 }}
					>
						{title}
					</text>
					{meta ? <text style={styles.description}>{meta}</text> : null}
					{action}
				</div>
				{children}
			</div>
			{footer ? <text style={styles.description}>{footer}</text> : null}
		</div>
	);
}

/** A divided list row; its main target and trailing controls activate independently. */
export function SettingsGroupRow({
	"aria-description": accessibleDescription,
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

	const content = (
		<>
			{leading}
			<div style={{ ...styles.column, flexGrow: 1, flexShrink: 1, gap: 0 }}>
				<text style={styles.label}>{label}</text>
				{description ? (
					<text style={styles.description}>{description}</text>
				) : null}
			</div>
			{badge ? <text style={styles.description}>{badge}</text> : null}
		</>
	);

	return (
		<div
			testId={onPress ? undefined : testId}
			style={{
				...groups.row,
				backgroundColor: selected ? theme.tokens.colors.selected : undefined,
			}}
		>
			<div
				testId={onPress ? testId : undefined}
				role={onPress ? "button" : undefined}
				aria-label={onPress && typeof label === "string" ? label : undefined}
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
					flexShrink: 1,
					minWidth: 0,
					cursor: interactive ? "pointer" : undefined,
					borderWidth: onPress ? 1 : 0,
					borderColor: focused ? theme.tokens.colors.focusRing : "transparent",
					borderRadius: radius.md,
					opacity: disabled ? 0.45 : 1,
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					armed.current = false;
				}}
				onClick={() => {
					if (interactive) onPress?.();
				}}
				onKeyDown={(event) => {
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
				}}
				onKeyUp={(event) => {
					if (event.key !== "space") return;

					const activate = armed.current;

					armed.current = false;

					if (interactive && activate) onPress?.();
				}}
			>
				{content}
			</div>
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
			<text style={settingsStyles.get(theme).description}>{children}</text>
		</div>
	);
}

import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "../styles/tokens";

/** Keyboard-activatable choice shared by account setup and author identity forms. */
export function ChoiceTile({
	label,
	source,
	selected,
	disabled,
	autoFocus,
	testId,
	accessibleName = label,
	description,
	detail,
	onPress,
}: {
	label: string;
	source: string;
	selected?: boolean;
	disabled: boolean;
	autoFocus?: boolean;
	testId: string;
	accessibleName?: string;
	description?: string;
	detail?: string;
	onPress: () => void;
}) {
	return (
		<Button
			testId={testId}
			aria-label={accessibleName}
			aria-description={description ?? (selected ? "Selected" : undefined)}
			aria-pressed={selected}
			disabled={disabled}
			autoFocus={autoFocus}
			tokens={appTokens}
			size="sm"
			variant={selected ? "secondary" : "ghost"}
			style={{
				flexGrow: 1,
				flexBasis: 0,
				minWidth: 0,
				height: detail ? 88 : 64,
				flexDirection: "column",
				gap: spacing[1.5],
				borderColor: selected
					? appTokens.colors.accentBorder
					: appTokens.colors.border,
			}}
			onPress={onPress}
		>
			<svg
				testId={`${testId}-icon`}
				source={source}
				style={{
					width: 22,
					height: 22,
					color: selected
						? appTokens.colors.accent
						: appTokens.colors.textMuted,
					pointerEvents: "none",
				}}
			/>
			<text
				style={{
					...typography.md,
					color: appTokens.colors.text,
					pointerEvents: "none",
					maxWidth: "100%",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{label}
			</text>
			{detail ? (
				<text
					style={{
						...typography.xs,
						color: appTokens.colors.textMuted,
						pointerEvents: "none",
						maxWidth: "100%",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{detail}
				</text>
			) : null}
		</Button>
	);
}

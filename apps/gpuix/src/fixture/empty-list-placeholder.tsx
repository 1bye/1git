import { spacing, radius } from "@1git/design-tokens";
import { appTokens } from "../styles/tokens";

/** Static decorative lines for empty lists, not a loading indicator. */
export function EmptyListPlaceholder() {
	return (
		<div
			aria-hidden
			testId="empty-list-placeholder"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[3],
				padding: spacing[3.5],
				paddingLeft: spacing[2],
				opacity: 0.45,
			}}
		>
			{["70%", "45%", "60%", "35%"].map((width, index) => (
				<div
					key={width}
					style={{
						width,
						height: 6,
						borderRadius: radius.sm,
						backgroundColor: appTokens.colors.border,
						marginTop: index === 2 ? spacing[2] : spacing[0],
					}}
				/>
			))}
		</div>
	);
}

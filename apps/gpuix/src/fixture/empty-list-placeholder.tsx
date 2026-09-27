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
				gap: 12,
				padding: 14,
				opacity: 0.45,
			}}
		>
			{["70%", "45%", "60%", "35%"].map((width, index) => (
				<div
					key={width}
					style={{
						width,
						height: 6,
						borderRadius: 3,
						backgroundColor: appTokens.colors.border,
						marginTop: index === 2 ? 8 : 0,
					}}
				/>
			))}
		</div>
	);
}
